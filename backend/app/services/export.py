from __future__ import annotations

import hashlib
import json
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from app.domain.models import (
    ActorType, AgentEvent, CandidateMatch, CandidateStatus, DatasetRole, ExportRecord,
    ExportValidationIssue, ExportValidationResult, FinalReview, MatchResult,
    ReconciliationSession, RuleStatus, utc_now,
)
from app.export.kigs_schema import load_export_profile
from app.services.reconciliation import ReconciliationNotReadyError, ReconciliationService


class ExportError(RuntimeError):
    def __init__(self, validation: ExportValidationResult) -> None:
        super().__init__("Final export validation failed")
        self.validation = validation


class KigsExportService:
    """Translate persisted canonical reconciliation state into a KIGS-style POC workbook."""

    def __init__(self, reconciliation: ReconciliationService) -> None:
        self.reconciliation = reconciliation
        self.repository = reconciliation.repository
        self.settings = reconciliation.settings

    def profile(self):
        return load_export_profile(self.settings.kigs_template_path)

    def _active_rules(self, session: ReconciliationSession) -> list:
        if not session.client_profile_id:
            return []
        return self.repository.list_active_rules(session.client_profile_id)

    def _state_version(self, session: ReconciliationSession) -> str:
        rules = [{"id": r.rule_id, "version": r.version, "status": r.status,
                  "authority": r.action_authority} for r in self._active_rules(session)]
        matches = self.repository.list_match_results(session.id)
        material = {
            "updated_at": session.updated_at.isoformat(),
            "mapping": session.confirmed_mapping.model_dump(mode="json") if session.confirmed_mapping else None,
            "policy": session.confirmed_policy.model_dump(mode="json") if session.confirmed_policy else None,
            "matches": [item.model_dump(mode="json") for item in matches],
            "near": session.near_match_analysis.model_dump(mode="json") if session.near_match_analysis else None,
            "rules": rules,
        }
        return hashlib.sha256(json.dumps(material, sort_keys=True, default=str).encode()).hexdigest()

    def validate(self, reconciliation_id: UUID) -> ExportValidationResult:
        session = self.reconciliation.get(reconciliation_id)
        issues: list[ExportValidationIssue] = []
        if not session.confirmed_mapping:
            issues.append(ExportValidationIssue(code="mapping_not_confirmed", message="Confirm schema mapping before export."))
        if not session.confirmed_policy:
            issues.append(ExportValidationIssue(code="policy_not_confirmed", message="Confirm reconciliation policy before export."))
        if not session.tolerance_summary or not session.near_match_analysis or not session.near_match_summary:
            issues.append(ExportValidationIssue(code="matching_incomplete", message="Run exact, tolerance, and near-match stages before export."))
        elif session.near_match_summary.near_match_proposals:
            issues.append(ExportValidationIssue(code="pending_match_decisions", message="Resolve all pending near-match proposals before export."))
        matches = self.repository.list_match_results(reconciliation_id)
        gov_ids = [item.government_record_id for item in matches]
        pr_ids = [item.purchase_register_record_id for item in matches]
        if len(gov_ids) != len(set(gov_ids)) or len(pr_ids) != len(set(pr_ids)):
            issues.append(ExportValidationIssue(code="duplicate_consumption", message="A source record is consumed more than once."))
        if session.client_profile_id and not self.repository.get_client_profile(session.client_profile_id):
            issues.append(ExportValidationIssue(code="profile_reference_invalid", message="The referenced client profile is unavailable."))
        profile = self.profile()
        missing = [field for field in profile.required_fields if field not in profile.field_order]
        if missing:
            issues.append(ExportValidationIssue(code="target_fields_missing", message=f"KIGS schema is missing required fields: {', '.join(missing)}"))
        return ExportValidationResult(valid=not issues, issues=issues, state_version=self._state_version(session))

    def review(self, reconciliation_id: UUID) -> FinalReview:
        session = self.reconciliation.get(reconciliation_id)
        validation = self.validate(reconciliation_id)
        summary = session.near_match_summary
        matches = self.repository.list_match_results(reconciliation_id)
        counts = {kind: sum(item.match_type == kind for item in matches)
                  for kind in ("exact", "tolerance", "near", "human_selected")}
        active = [{"rule_id": r.rule_id, "version": r.version, "status": r.status,
                   "action_authority": r.action_authority} for r in self._active_rules(session)]
        return FinalReview(
            reconciliation_id=reconciliation_id,
            exact_matches=counts["exact"], tolerance_matches=counts["tolerance"],
            near_matches=counts["near"], human_selected_matches=counts["human_selected"],
            resolved_records=sum(counts.values()),
            unresolved_records=(summary.ambiguous_records + summary.material_mismatch_records +
                                summary.gst_only_records + summary.pr_only_records) if summary else 0,
            ambiguous_records=summary.ambiguous_records if summary else 0,
            material_mismatch_records=summary.material_mismatch_records if summary else 0,
            gst_only_records=summary.gst_only_records if summary else 0,
            pr_only_records=summary.pr_only_records if summary else 0,
            client_profile_id=session.client_profile_id, profile_version=session.profile_version,
            policy_version=session.confirmed_policy.revision if session.confirmed_policy else 0,
            active_rules=active, export_profile=self.profile(), validation=validation,
        )

    @staticmethod
    def _mapping(session: ReconciliationSession) -> dict[DatasetRole, dict[str, str]]:
        return {dataset.source_dataset: {item.canonical_field: item.source_column for item in dataset.mappings
                if item.canonical_field} for dataset in session.confirmed_mapping.datasets}  # type: ignore[union-attr]

    @staticmethod
    def _json_value(value: Any) -> Any:
        if value is None or (not isinstance(value, (list, dict)) and pd.isna(value)):
            return None
        if isinstance(value, pd.Timestamp):
            return value.to_pydatetime()
        if hasattr(value, "item"):
            return value.item()
        return value

    def _source_rows(self, session: ReconciliationSession):
        mapping = self._mapping(session)
        government = self.reconciliation.parser.parse(Path(session.government_file.stored_path), DatasetRole.GOVERNMENT).dataframe  # type: ignore[union-attr]
        purchase = self.reconciliation.parser.parse(Path(session.purchase_register_file.stored_path), DatasetRole.PURCHASE_REGISTER).dataframe  # type: ignore[union-attr]

        def rows(frame, role):
            id_column = mapping[role]["record_id"]
            result = {}
            for _, row in frame.iterrows():
                raw = {str(key): self._json_value(value) for key, value in row.to_dict().items()}
                canonical = {field: self._json_value(row[column]) for field, column in mapping[role].items()}
                result[str(row[id_column]).strip()] = (raw, canonical)
            return result
        return rows(government, DatasetRole.GOVERNMENT), rows(purchase, DatasetRole.PURCHASE_REGISTER)

    @staticmethod
    def _amount(values: dict[str, Any], field: str) -> float | None:
        value = values.get(field)
        if value is None or value == "":
            return None
        return float(Decimal(str(value)))

    def _side(self, prefix: str, values: dict[str, Any]) -> dict[str, Any]:
        taxable = self._amount(values, "taxable_value")
        tax_fields = [self._amount(values, name) for name in ("igst", "cgst", "sgst", "cess")]
        total = None if taxable is None else taxable + sum(value or 0 for value in tax_fields)
        return {
            f"{prefix}Gstin": values.get("gstin"), f"{prefix}TradeName": values.get("counterparty_name"),
            f"{prefix}DocumentNumber": values.get("document_number"), f"{prefix}DocumentDate": values.get("document_date"),
            f"{prefix}DocumentType": values.get("document_type"), f"{prefix}Value": total,
            f"{prefix}TaxableValue": taxable, f"{prefix}Rate": self._amount(values, "gst_rate"),
            f"{prefix}IgstAmount": tax_fields[0], f"{prefix}CgstAmount": tax_fields[1],
            f"{prefix}SgstAmount": tax_fields[2], f"{prefix}CessAmount": tax_fields[3],
        }

    @staticmethod
    def _reason(status: str, match: MatchResult | None = None) -> str:
        if status == "EXACT_MATCHED":
            return "Canonical GSTIN, document, value, rate, and tax fields matched exactly."
        if status == "TOLERANCE_MATCHED":
            return "GSTIN and document number matched; differences remained within the confirmed policy tolerances."
        if status == "NEAR_MATCHED":
            return "Human-approved near match supported by deterministic candidate evidence."
        if status == "HUMAN_SELECTED":
            return "A human explicitly selected this Purchase Register candidate for the ambiguous Government record."
        if status == "MATERIAL_MISMATCH":
            return "A potential counterpart exists, but one or more financial differences exceed configured safety limits."
        if status == "AMBIGUOUS":
            return "Multiple similarly strong Purchase Register candidates require human selection."
        if status == "GST_ONLY":
            return "No eligible Purchase Register counterpart was identified."
        if status == "PR_ONLY":
            return "No eligible Government GST counterpart was identified."
        return "The record remains unreconciled."

    def _row(self, profile, status: str, gov_pair=None, pr_pair=None, match: MatchResult | None = None,
             timestamp: datetime | None = None) -> dict[str, Any]:
        gov_raw, gov = gov_pair or ({}, {})
        pr_raw, pr = pr_pair or ({}, {})
        row = {name: None for name in profile.field_order}
        row.update(self._side("CP", gov) if gov else {})
        row.update(self._side("PR", pr) if pr else {})
        row.update({
            "LocationGstin": pr_raw.get("Purchase_Register_GSTIN"),
            "ReconciliationSection": profile.status_mapping[status],
            "SuggReconciliationSection": profile.status_mapping[status],
            "Reason": self._reason(status, match),
            "ActionStatus": profile.action_mapping["default_status"],
            "Action": profile.action_mapping["default_action"],
            "ReconciledBy": "POC user" if status == "HUMAN_SELECTED" else "SYSTEM",
            "ManualReconciliation": "Yes" if status == "HUMAN_SELECTED" else "No",
            "ReconciliationDateTime": timestamp,
            "ReferenceId": (match.government_record_id if match else gov.get("record_id")) or pr.get("record_id"),
        })
        for key, canonical in (("TaxableDifference", "taxable_value"), ("IGSTDifference", "igst"),
                               ("CGSTDifference", "cgst"), ("SGSTDifference", "sgst"),
                               ("CessDifference", "cess")):
            left, right = self._amount(gov, canonical), self._amount(pr, canonical)
            row[key] = None if left is None or right is None else right - left
        cp_value, pr_value = row.get("CPValue"), row.get("PRValue")
        row["ValueDifference"] = None if cp_value is None or pr_value is None else pr_value - cp_value
        for name in profile.field_order:
            if row.get(name) is None:
                row[name] = gov_raw.get(name, pr_raw.get(name))
        return row

    def _outcomes(self, session: ReconciliationSession) -> list[tuple[str, Any, Any, MatchResult | None]]:
        government, purchase = self._source_rows(session)
        matches = self.repository.list_match_results(session.id)
        outcomes = [(f"{item.match_type.upper()}_MATCHED" if item.match_type != "human_selected" else "HUMAN_SELECTED",
                     government[item.government_record_id], purchase[item.purchase_register_record_id], item)
                    for item in matches]
        # Correct the mechanical name generated above for exact/tolerance/near.
        outcomes = [(status.replace("EXACT_MATCHED", "EXACT_MATCHED").replace("TOLERANCE_MATCHED", "TOLERANCE_MATCHED").replace("NEAR_MATCHED", "NEAR_MATCHED"), g, p, m)
                    for status, g, p, m in outcomes]
        analysis = session.near_match_analysis
        candidates_by_gov: dict[str, list[CandidateMatch]] = {}
        for candidate in analysis.candidates:  # type: ignore[union-attr]
            candidates_by_gov.setdefault(candidate.government_record_id, []).append(candidate)
        for values in candidates_by_gov.values():
            values.sort(key=lambda item: (item.rank, -item.match_score))
        matched_gov = {item.government_record_id for item in matches}
        matched_pr = {item.purchase_register_record_id for item in matches}
        for ambiguity in analysis.ambiguities:  # type: ignore[union-attr]
            if ambiguity.government_record_id in matched_gov:
                continue
            candidate = candidates_by_gov.get(ambiguity.government_record_id, [None])[0]
            pr_pair = purchase.get(candidate.purchase_register_record_id) if candidate else None
            outcomes.append(("AMBIGUOUS", government[ambiguity.government_record_id], pr_pair, None))
        for gov_id in analysis.material_mismatch_government_ids:  # type: ignore[union-attr]
            candidate = candidates_by_gov.get(gov_id, [None])[0]
            pr_pair = purchase.get(candidate.purchase_register_record_id) if candidate else None
            outcomes.append(("MATERIAL_MISMATCH", government[gov_id], pr_pair, None))
        outcomes.extend(("GST_ONLY", government[record_id], None, None)
                        for record_id in analysis.gst_only_government_ids)  # type: ignore[union-attr]
        outcomes.extend(("PR_ONLY", None, purchase[record_id], None)
                        for record_id in analysis.pr_only_purchase_register_ids)  # type: ignore[union-attr]
        return outcomes

    @staticmethod
    def _safe(value: Any) -> Any:
        if isinstance(value, str) and value.startswith(("=", "+", "@", "-")):
            return "'" + value
        if isinstance(value, Decimal):
            return float(value)
        if isinstance(value, datetime) and value.tzinfo is not None:
            return value.astimezone().replace(tzinfo=None)
        if isinstance(value, date) and not isinstance(value, datetime):
            return datetime.combine(value, datetime.min.time())
        return value

    @staticmethod
    def _style_sheet(sheet, freeze: str | None = None) -> None:
        sheet.sheet_view.showGridLines = False
        if freeze:
            sheet.freeze_panes = freeze
        for cell in sheet[1]:
            cell.fill = PatternFill("solid", fgColor="172033")
            cell.font = Font(color="FFFFFF", bold=True)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        sheet.auto_filter.ref = sheet.dimensions
        for column in range(1, sheet.max_column + 1):
            values = [str(sheet.cell(row, column).value or "") for row in range(1, min(sheet.max_row, 100) + 1)]
            sheet.column_dimensions[get_column_letter(column)].width = min(36, max(12, max(map(len, values), default=12) + 2))

    def generate(self, reconciliation_id: UUID, actor: str = "POC user") -> ExportRecord:
        validation = self.validate(reconciliation_id)
        if not validation.valid:
            raise ExportError(validation)
        session, profile = self.reconciliation.get(reconciliation_id), self.profile()
        outcomes = self._outcomes(session)
        events = self.repository.list_events(reconciliation_id, 10_000)
        human_times = {event.metadata.get("government_record_id"): event.timestamp for event in events
                       if event.event_type == "ambiguous_candidate.human_selected"}
        rows = [self._row(profile, status, gov, pr, match,
                          human_times.get(match.government_record_id) if match and status == "HUMAN_SELECTED" else session.updated_at)
                for status, gov, pr, match in outcomes]
        version = len(self.repository.list_exports(reconciliation_id)) + 1
        export_id = UUID(bytes=hashlib.sha256(f"{reconciliation_id}:{version}:{utc_now().isoformat()}".encode()).digest()[:16])
        directory = self.settings.export_dir / str(reconciliation_id)
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"KIGS_Reconciliation_POC_v{version}_{str(export_id)[:8]}.xlsx"

        workbook = Workbook()
        primary = workbook.active
        primary.title = "KIGS_Reconciliation"
        primary.append(profile.field_order)
        for row in rows:
            primary.append([self._safe(row.get(header)) for header in profile.field_order])
        self._style_sheet(primary, "A2")

        review = self.review(reconciliation_id)
        summary = workbook.create_sheet("Summary")
        summary.append(["Metric", "Value"])
        summary_rows = [
            ("Government Record Count", session.near_match_summary.government_records),
            ("Purchase Register Record Count", session.near_match_summary.purchase_register_records),
            ("Exact Matches", review.exact_matches), ("Tolerance Matches", review.tolerance_matches),
            ("Near Matches", review.near_matches), ("Human Selected Matches", review.human_selected_matches),
            ("Resolved", review.resolved_records), ("Unresolved Outcomes", review.unresolved_records),
            ("Ambiguous", review.ambiguous_records), ("Material Mismatch", review.material_mismatch_records),
            ("GST Only", review.gst_only_records), ("PR Only", review.pr_only_records),
            ("Reconciliation Coverage", review.resolved_records / session.near_match_summary.government_records),
            ("Client Profile", str(session.client_profile_id or "")), ("Profile Version", session.profile_version or ""),
            ("Policy Version", review.policy_version), ("Export Profile", profile.name),
            ("Export Profile Version", profile.version), ("Generated At", utc_now()),
            ("Export ID", str(export_id)), ("Variance Convention", "PR minus CP"),
            ("ReconciliationPercentage", "Blank in POC because official business semantics are unconfirmed"),
        ]
        for item in summary_rows:
            summary.append([self._safe(item[0]), self._safe(item[1])])
        summary["B14"].number_format = "0.0%"
        self._style_sheet(summary, "A2")

        unresolved = workbook.create_sheet("Unresolved_Exceptions")
        unresolved_headers = ["Status", "GovernmentRecordId", "PurchaseRegisterRecordId", "DocumentNumber", "Reason", "TaxableDifference", "CandidateCount", "SemanticCategory", "SuggestedAction", "HumanReviewState"]
        unresolved.append(unresolved_headers)
        for status, gov_pair, pr_pair, _ in outcomes:
            if status not in {"AMBIGUOUS", "MATERIAL_MISMATCH", "GST_ONLY", "PR_ONLY"}:
                continue
            gov = gov_pair[1] if gov_pair else {}
            pr = pr_pair[1] if pr_pair else {}
            classification = next((item for item in self.repository.list_semantic_classifications(reconciliation_id)
                                   if item.record_id == (gov.get("record_id") or pr.get("record_id"))), None)
            unresolved.append([
                status, gov.get("record_id"), pr.get("record_id"), gov.get("document_number") or pr.get("document_number"),
                self._reason(status), (self._amount(pr, "taxable_value") or 0) - (self._amount(gov, "taxable_value") or 0)
                if gov and pr else None, len([c for c in session.near_match_analysis.candidates if c.government_record_id == gov.get("record_id")]),
                classification.final_category or classification.proposed_category if classification else None,
                classification.suggested_action if classification else "Review reconciliation evidence",
                "Pending human review",
            ])
        self._style_sheet(unresolved, "A2")

        configuration = workbook.create_sheet("Configuration")
        configuration.append(["Section", "Item", "Value", "Detail"])
        config_rows: list[tuple[object, object, object, object]] = []
        for dataset in session.confirmed_mapping.datasets:
            for mapping in dataset.mappings:
                config_rows.append(("Schema Mapping", dataset.source_dataset,
                                    mapping.canonical_field or "unmapped", mapping.source_column))
        config_rows.extend([
            ("Policy", "Name", session.confirmed_policy.name, f"Revision {session.confirmed_policy.revision}"),
            ("Policy", "Status", session.confirmed_policy.status, session.confirmed_policy.proposed_by),
        ])
        for rule in sorted(session.confirmed_policy.rules, key=lambda item: item.priority):
            tolerance = ""
            if rule.tolerance:
                tolerance = f"{rule.tolerance.value} {rule.tolerance.unit}"
            config_rows.append(("Policy Rule", rule.canonical_field, rule.operator,
                                f"required={rule.required}; enabled={rule.enabled}; tolerance={tolerance}"))
        for name, value in session.near_match_analysis.thresholds.model_dump(mode="json").items():
            config_rows.append(("Near Match Threshold", name, value, ""))
        for rule in review.active_rules:
            config_rows.append(("Active Rule", rule.get("rule_id"), rule.get("version"),
                                f"authority={rule.get('authority')}; automatic reconciliations=0"))
        config_rows.extend([
            ("Lineage", "Client Profile / Version", session.client_profile_id or "", session.profile_version or ""),
            ("Lineage", "Export Profile / Version", profile.export_profile_id, profile.version),
            ("Lineage", "Schema Source", profile.schema_source, ""),
            ("Limitation", "Official Template", "Not supplied" if profile.schema_source == "CONFIGURED_POC" else "Loaded",
             "Formal KIGS compatibility requires the official header-only workbook" if profile.schema_source == "CONFIGURED_POC" else "Exact template headers and order preserved"),
        ])
        for item in config_rows:
            configuration.append([self._safe(value) for value in item])
        configuration.column_dimensions["A"].width = 24
        configuration.column_dimensions["B"].width = 32
        configuration.column_dimensions["C"].width = 32
        configuration.column_dimensions["D"].width = 60
        for row in configuration.iter_rows():
            for cell in row:
                cell.alignment = Alignment(wrap_text=True, vertical="top")
        self._style_sheet(configuration, "A2")

        audit = workbook.create_sheet("Audit_Summary")
        audit.append(["Timestamp", "Actor", "Component", "Event", "Object Type", "Object ID", "Outcome"])
        for event in reversed(events):
            object_type, object_id = "reconciliation", str(reconciliation_id)
            for candidate in ("export_id", "rule_id", "profile_id", "candidate_id", "government_record_id"):
                if event.metadata.get(candidate):
                    object_type, object_id = candidate.removesuffix("_id"), str(event.metadata[candidate])
                    break
            audit.append([self._safe(event.timestamp), event.actor_type, event.component, event.event_type,
                          object_type, self._safe(object_id), event.result])
        self._style_sheet(audit, "A2")

        workbook.save(path)
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        record = ExportRecord(
            export_id=export_id, version=version, reconciliation_id=reconciliation_id,
            client_profile_id=session.client_profile_id, client_profile_version=session.profile_version,
            policy_version=session.confirmed_policy.revision, export_profile_id=profile.export_profile_id,
            export_profile_version=profile.version, created_by=actor, row_count=len(rows),
            schema_source=profile.schema_source, file_path=str(path.resolve()), sha256=digest,
            state_version=validation.state_version,
        )
        self.repository.save_export(record)
        self.repository.add_event(AgentEvent(
            event_type="export.generated", reconciliation_id=reconciliation_id,
            actor_type=ActorType.USER, component="kigs_export_adapter", result="completed",
            output_count=len(rows), metadata={"export_id": str(export_id), "version": version,
                                               "sha256": digest, "schema_source": profile.schema_source},
        ))
        return record

    def history(self, reconciliation_id: UUID) -> list[ExportRecord]:
        session = self.reconciliation.get(reconciliation_id)
        current = self._state_version(session)
        return [item.model_copy(update={"stale": item.state_version != current})
                for item in self.repository.list_exports(reconciliation_id)]

    def get(self, export_id: UUID) -> ExportRecord:
        record = self.repository.get_export(export_id)
        if not record:
            raise ReconciliationNotReadyError("Export not found")
        return record
