from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import closing
from pathlib import Path
from uuid import UUID

from app.domain.models import (
    AgentEvent,
    CandidateStatus,
    ConfirmedMappingSet,
    DatasetRole,
    MatchResult,
    MatchConflict,
    NaturalLanguagePolicyProposal,
    NearMatchAnalysis,
    NearMatchReconciliationSummary,
    PolicyValidationResult,
    ReconciliationPolicy,
    ReconciliationListItem,
    ReconciliationSession,
    ReconciliationSummary,
    ToleranceReconciliationSummary,
    SchemaMappingProposal,
    SessionStatus,
    UploadedFile,
    CopilotMessage,
    SemanticClassification,
    ClientProfile,
    PatternSuggestion,
    ReusableRuleVersion,
    RuleExecution,
    ExportRecord,
    AIInvestigationRecord,
    utc_now,
)


class SQLiteReconciliationRepository:
    def __init__(self, database_path: Path) -> None:
        self.database_path = database_path

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self._connect()) as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS reconciliations (
                    id TEXT PRIMARY KEY,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    government_file_json TEXT,
                    purchase_register_file_json TEXT,
                    mapping_proposal_json TEXT,
                    confirmed_mapping_json TEXT,
                    mapping_validation_json TEXT,
                    workflow_thread_id TEXT,
                    summary_json TEXT,
                    policy_proposal_json TEXT,
                    confirmed_policy_json TEXT,
                    policy_validation_json TEXT,
                    policy_workflow_thread_id TEXT,
                    tolerance_summary_json TEXT,
                    conflicts_json TEXT,
                    near_match_analysis_json TEXT,
                    near_match_summary_json TEXT,
                    near_workflow_thread_id TEXT
                );
                CREATE TABLE IF NOT EXISTS match_results (
                    reconciliation_id TEXT NOT NULL,
                    government_record_id TEXT NOT NULL,
                    purchase_register_record_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    PRIMARY KEY (reconciliation_id, government_record_id),
                    UNIQUE (reconciliation_id, purchase_register_record_id),
                    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
                );
                CREATE TABLE IF NOT EXISTS audit_events (
                    id TEXT PRIMARY KEY,
                    reconciliation_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
                );
                CREATE INDEX IF NOT EXISTS idx_audit_reconciliation_timestamp
                    ON audit_events(reconciliation_id, timestamp DESC);
                CREATE TABLE IF NOT EXISTS semantic_classifications (
                    reconciliation_id TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (reconciliation_id, record_id),
                    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
                );
                CREATE TABLE IF NOT EXISTS copilot_messages (
                    id TEXT PRIMARY KEY,
                    reconciliation_id TEXT NOT NULL,
                    conversation_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_copilot_conversation
                    ON copilot_messages(reconciliation_id, conversation_id, created_at);
                CREATE TABLE IF NOT EXISTS client_profiles (
                    id TEXT PRIMARY KEY, client_name TEXT NOT NULL, profile_name TEXT NOT NULL,
                    status TEXT NOT NULL, version INTEGER NOT NULL,
                    saved_mapping_json TEXT NOT NULL, saved_policy_json TEXT NOT NULL,
                    created_from_reconciliation_id TEXT NOT NULL, metadata_json TEXT NOT NULL,
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS client_profile_versions (
                    profile_id TEXT NOT NULL, version INTEGER NOT NULL,
                    saved_mapping_json TEXT NOT NULL, saved_policy_json TEXT NOT NULL,
                    metadata_json TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY (profile_id, version),
                    FOREIGN KEY (profile_id) REFERENCES client_profiles(id)
                );
                CREATE TABLE IF NOT EXISTS reusable_rules (
                    rule_id TEXT PRIMARY KEY, client_profile_id TEXT NOT NULL,
                    current_version INTEGER NOT NULL, created_at TEXT NOT NULL,
                    FOREIGN KEY (client_profile_id) REFERENCES client_profiles(id)
                );
                CREATE TABLE IF NOT EXISTS rule_versions (
                    rule_id TEXT NOT NULL, version INTEGER NOT NULL, status TEXT NOT NULL,
                    payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
                    PRIMARY KEY (rule_id, version),
                    FOREIGN KEY (rule_id) REFERENCES reusable_rules(rule_id)
                );
                CREATE TABLE IF NOT EXISTS pattern_suggestions (
                    id TEXT PRIMARY KEY, reconciliation_id TEXT NOT NULL, pattern_key TEXT NOT NULL,
                    disposition TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
                    UNIQUE (reconciliation_id, pattern_key),
                    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
                );
                CREATE TABLE IF NOT EXISTS rule_executions (
                    id TEXT PRIMARY KEY, reconciliation_id TEXT NOT NULL, rule_id TEXT NOT NULL,
                    rule_version INTEGER NOT NULL, records_evaluated INTEGER NOT NULL,
                    records_affected INTEGER NOT NULL, result TEXT NOT NULL, timestamp TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS reconciliation_exports (
                    export_id TEXT PRIMARY KEY, reconciliation_id TEXT NOT NULL,
                    version INTEGER NOT NULL, created_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    UNIQUE (reconciliation_id, version),
                    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
                );
                CREATE INDEX IF NOT EXISTS idx_exports_reconciliation
                    ON reconciliation_exports(reconciliation_id, version DESC);
                CREATE TABLE IF NOT EXISTS ai_investigations (
                    id TEXT PRIMARY KEY,
                    reconciliation_id TEXT NOT NULL,
                    record_id TEXT NOT NULL,
                    started_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    FOREIGN KEY (reconciliation_id) REFERENCES reconciliations(id)
                );
                CREATE INDEX IF NOT EXISTS idx_ai_investigations_record
                    ON ai_investigations(reconciliation_id, record_id, started_at DESC);
                """
            )
            existing_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(reconciliations)").fetchall()
            }
            for column in (
                "mapping_proposal_json",
                "confirmed_mapping_json",
                "mapping_validation_json",
                "workflow_thread_id",
                "policy_proposal_json",
                "confirmed_policy_json",
                "policy_validation_json",
                "policy_workflow_thread_id",
                "tolerance_summary_json",
                "conflicts_json",
                "near_match_analysis_json",
                "near_match_summary_json",
                "near_workflow_thread_id",
                "client_profile_id",
                "profile_version",
            ):
                if column not in existing_columns:
                    connection.execute(f"ALTER TABLE reconciliations ADD COLUMN {column} TEXT")
            execution_columns = {
                row["name"]
                for row in connection.execute("PRAGMA table_info(rule_executions)").fetchall()
            }
            if "automatic_reconciliations" not in execution_columns:
                connection.execute(
                    "ALTER TABLE rule_executions ADD COLUMN automatic_reconciliations INTEGER NOT NULL DEFAULT 0"
                )
            if "action_authority" not in execution_columns:
                connection.execute(
                    "ALTER TABLE rule_executions ADD COLUMN action_authority TEXT NOT NULL DEFAULT 'PROPOSE_ONLY'"
                )
            connection.commit()

    def save_client_profile(self, profile: ClientProfile) -> None:
        metadata = profile.model_dump(mode="json", exclude={"saved_mapping", "saved_policy"})
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO client_profiles(id, client_name, profile_name, status, version,
                saved_mapping_json, saved_policy_json, created_from_reconciliation_id, metadata_json,
                created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET status=excluded.status, version=excluded.version,
                saved_mapping_json=excluded.saved_mapping_json, saved_policy_json=excluded.saved_policy_json,
                metadata_json=excluded.metadata_json, updated_at=excluded.updated_at""",
                (str(profile.id), profile.client_name, profile.profile_name, profile.status.value, profile.version,
                 profile.saved_mapping.model_dump_json(), profile.saved_policy.model_dump_json(),
                 str(profile.created_from_reconciliation_id), json.dumps(metadata),
                 profile.created_at.isoformat(), profile.updated_at.isoformat()),
            )
            connection.execute(
                """INSERT OR IGNORE INTO client_profile_versions(profile_id,version,saved_mapping_json,
                saved_policy_json,metadata_json,created_at) VALUES(?,?,?,?,?,?)""",
                (str(profile.id), profile.version, profile.saved_mapping.model_dump_json(),
                 profile.saved_policy.model_dump_json(), json.dumps(metadata), profile.updated_at.isoformat()),
            )
            connection.commit()

    def get_client_profile(self, profile_id: UUID) -> ClientProfile | None:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT * FROM client_profiles WHERE id=?", (str(profile_id),)).fetchone()
        if not row:
            return None
        metadata = json.loads(row["metadata_json"])
        metadata["saved_mapping"] = json.loads(row["saved_mapping_json"])
        metadata["saved_policy"] = json.loads(row["saved_policy_json"])
        return ClientProfile.model_validate(metadata)

    def list_client_profiles(self) -> list[ClientProfile]:
        with closing(self._connect()) as connection:
            ids = [UUID(row["id"]) for row in connection.execute("SELECT id FROM client_profiles ORDER BY updated_at DESC")]
        return [item for profile_id in ids if (item := self.get_client_profile(profile_id))]

    def attach_profile(self, reconciliation_id: UUID, profile_id: UUID, version: int) -> None:
        with closing(self._connect()) as connection:
            connection.execute("UPDATE reconciliations SET client_profile_id=?, profile_version=? WHERE id=?",
                               (str(profile_id), version, str(reconciliation_id)))
            connection.commit()

    def save_rule_version(self, rule: ReusableRuleVersion) -> None:
        with closing(self._connect()) as connection:
            connection.execute("INSERT OR IGNORE INTO reusable_rules(rule_id, client_profile_id, current_version, created_at) VALUES (?, ?, ?, ?)",
                               (rule.rule_id, str(rule.client_profile_id), rule.version, rule.created_at.isoformat()))
            connection.execute("UPDATE reusable_rules SET current_version=MAX(current_version, ?) WHERE rule_id=?", (rule.version, rule.rule_id))
            connection.execute("""INSERT INTO rule_versions(rule_id, version, status, payload_json, created_at)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(rule_id,version) DO UPDATE SET status=excluded.status,payload_json=excluded.payload_json""",
                               (rule.rule_id, rule.version, rule.status.value, rule.model_dump_json(), rule.created_at.isoformat()))
            connection.commit()

    def get_rule(self, rule_id: str, version: int | None = None) -> ReusableRuleVersion | None:
        with closing(self._connect()) as connection:
            row = connection.execute("SELECT payload_json FROM rule_versions WHERE rule_id=? " +
                                     ("AND version=?" if version else "ORDER BY version DESC LIMIT 1"),
                                     (rule_id, version) if version else (rule_id,)).fetchone()
        return ReusableRuleVersion.model_validate_json(row["payload_json"]) if row else None

    def list_rules(self, profile_id: UUID | None = None) -> list[ReusableRuleVersion]:
        query = """SELECT rv.payload_json FROM rule_versions rv JOIN reusable_rules r ON r.rule_id=rv.rule_id
                   WHERE rv.version=r.current_version"""
        params: tuple = ()
        if profile_id:
            query += " AND r.client_profile_id=?"
            params = (str(profile_id),)
        query += " ORDER BY rv.created_at DESC"
        with closing(self._connect()) as connection:
            rows = connection.execute(query, params).fetchall()
        return [ReusableRuleVersion.model_validate_json(row["payload_json"]) for row in rows]

    def list_active_rules(self, profile_id: UUID) -> list[ReusableRuleVersion]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT rv.payload_json FROM rule_versions rv JOIN reusable_rules r ON r.rule_id=rv.rule_id
                WHERE r.client_profile_id=? AND rv.status='ACTIVE' ORDER BY rv.rule_id""", (str(profile_id),)
            ).fetchall()
        return [ReusableRuleVersion.model_validate_json(row["payload_json"]) for row in rows]

    def list_rule_history(self, rule_id: str) -> list[ReusableRuleVersion]:
        with closing(self._connect()) as connection:
            rows = connection.execute("SELECT payload_json FROM rule_versions WHERE rule_id=? ORDER BY version DESC", (rule_id,)).fetchall()
        return [ReusableRuleVersion.model_validate_json(row["payload_json"]) for row in rows]

    def save_rule_execution(self, execution: RuleExecution) -> None:
        with closing(self._connect()) as connection:
            connection.execute("""INSERT INTO rule_executions(id,reconciliation_id,rule_id,rule_version,
                records_evaluated,records_affected,result,timestamp,automatic_reconciliations,action_authority)
                VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (str(execution.id), str(execution.reconciliation_id), execution.rule_id, execution.rule_version,
                 execution.records_evaluated, execution.records_affected, execution.result,
                 execution.timestamp.isoformat(), execution.automatic_reconciliations,
                 execution.action_authority.value))
            connection.commit()

    def list_rule_executions(self, reconciliation_id: UUID) -> list[RuleExecution]:
        with closing(self._connect()) as connection:
            rows = connection.execute("SELECT * FROM rule_executions WHERE reconciliation_id=? ORDER BY timestamp", (str(reconciliation_id),)).fetchall()
        return [RuleExecution(id=row["id"], reconciliation_id=row["reconciliation_id"], rule_id=row["rule_id"],
                              rule_version=row["rule_version"], records_evaluated=row["records_evaluated"],
                              records_affected=row["records_affected"], result=row["result"], timestamp=row["timestamp"],
                              automatic_reconciliations=row["automatic_reconciliations"],
                              action_authority=row["action_authority"])
                for row in rows]

    def save_export(self, record: ExportRecord) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO reconciliation_exports(export_id,reconciliation_id,version,created_at,payload_json)
                VALUES(?,?,?,?,?)""",
                (str(record.export_id), str(record.reconciliation_id), record.version,
                 record.created_at.isoformat(), record.model_dump_json()),
            )
            connection.commit()

    def list_exports(self, reconciliation_id: UUID) -> list[ExportRecord]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT payload_json FROM reconciliation_exports WHERE reconciliation_id=? ORDER BY version DESC",
                (str(reconciliation_id),),
            ).fetchall()
        return [ExportRecord.model_validate_json(row["payload_json"]) for row in rows]

    def get_export(self, export_id: UUID) -> ExportRecord | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT payload_json FROM reconciliation_exports WHERE export_id=?", (str(export_id),)
            ).fetchone()
        return ExportRecord.model_validate_json(row["payload_json"]) if row else None

    def save_pattern_suggestion(self, suggestion: PatternSuggestion) -> PatternSuggestion:
        with closing(self._connect()) as connection:
            connection.execute("""INSERT INTO pattern_suggestions(id,reconciliation_id,pattern_key,disposition,payload_json,created_at)
                VALUES(?,?,?,?,?,?) ON CONFLICT(reconciliation_id,pattern_key) DO UPDATE SET disposition=excluded.disposition,payload_json=excluded.payload_json""",
                               (str(suggestion.id), str(suggestion.reconciliation_id), suggestion.pattern_key,
                                suggestion.disposition.value, suggestion.model_dump_json(), suggestion.created_at.isoformat()))
            connection.commit()
        return suggestion

    def list_pattern_suggestions(self, reconciliation_id: UUID) -> list[PatternSuggestion]:
        with closing(self._connect()) as connection:
            rows = connection.execute("SELECT payload_json FROM pattern_suggestions WHERE reconciliation_id=? ORDER BY created_at DESC", (str(reconciliation_id),)).fetchall()
        return [PatternSuggestion.model_validate_json(row["payload_json"]) for row in rows]

    def create(self, session: ReconciliationSession) -> ReconciliationSession:
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO reconciliations(id, status, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (
                    str(session.id),
                    session.status.value,
                    session.created_at.isoformat(),
                    session.updated_at.isoformat(),
                ),
            )
            connection.commit()
        return session

    def list_sessions(self) -> list[ReconciliationListItem]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT r.*, cp.client_name
                FROM reconciliations AS r
                LEFT JOIN client_profiles AS cp ON cp.id = r.client_profile_id
                ORDER BY r.updated_at DESC"""
            ).fetchall()

        items: list[ReconciliationListItem] = []
        for row in rows:
            government_file = (
                UploadedFile.model_validate_json(row["government_file_json"])
                if row["government_file_json"] else None
            )
            purchase_file = (
                UploadedFile.model_validate_json(row["purchase_register_file_json"])
                if row["purchase_register_file_json"] else None
            )
            exact = (
                ReconciliationSummary.model_validate_json(row["summary_json"])
                if row["summary_json"] else None
            )
            tolerance = (
                ToleranceReconciliationSummary.model_validate_json(row["tolerance_summary_json"])
                if row["tolerance_summary_json"] else None
            )
            near = (
                NearMatchReconciliationSummary.model_validate_json(row["near_match_summary_json"])
                if row["near_match_summary_json"] else None
            )
            totals = near or tolerance or exact
            if near:
                current_stage = "exceptions" if near.near_match_proposals == 0 else "near-matches"
            elif tolerance:
                current_stage = "near-matches"
            elif exact:
                current_stage = "results"
            elif row["confirmed_policy_json"]:
                current_stage = "results"
            elif row["policy_proposal_json"] or row["confirmed_mapping_json"]:
                current_stage = "policy"
            elif row["mapping_proposal_json"]:
                current_stage = "mapping"
            else:
                current_stage = "setup"
            items.append(ReconciliationListItem(
                id=row["id"],
                status=row["status"],
                created_at=row["created_at"],
                updated_at=row["updated_at"],
                client_name=row["client_name"],
                government_filename=government_file.original_filename if government_file else None,
                purchase_register_filename=purchase_file.original_filename if purchase_file else None,
                government_records=government_file.profile.row_count if government_file else 0,
                purchase_register_records=purchase_file.profile.row_count if purchase_file else 0,
                resolved_records=(
                    totals.resolved_records
                    if isinstance(totals, (ToleranceReconciliationSummary, NearMatchReconciliationSummary))
                    else totals.exact_matches if totals else 0
                ),
                remaining_government_records=(
                    totals.remaining_government_records
                    if totals else government_file.profile.row_count if government_file else 0
                ),
                remaining_purchase_register_records=(
                    totals.remaining_purchase_register_records
                    if totals else purchase_file.profile.row_count if purchase_file else 0
                ),
                current_stage=current_stage,
            ))
        return items

    def get(self, reconciliation_id: UUID) -> ReconciliationSession | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT * FROM reconciliations WHERE id = ?", (str(reconciliation_id),)
            ).fetchone()
        if row is None:
            return None
        return ReconciliationSession(
            id=UUID(row["id"]),
            status=SessionStatus(row["status"]),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            government_file=(
                UploadedFile.model_validate_json(row["government_file_json"])
                if row["government_file_json"]
                else None
            ),
            purchase_register_file=(
                UploadedFile.model_validate_json(row["purchase_register_file_json"])
                if row["purchase_register_file_json"]
                else None
            ),
            mapping_proposal=(
                SchemaMappingProposal.model_validate_json(row["mapping_proposal_json"])
                if row["mapping_proposal_json"]
                else None
            ),
            confirmed_mapping=(
                ConfirmedMappingSet.model_validate_json(row["confirmed_mapping_json"])
                if row["confirmed_mapping_json"]
                else None
            ),
            mapping_validation=(
                SchemaMappingProposal.model_validate_json(row["mapping_proposal_json"]).validation
                if row["mapping_proposal_json"]
                else None
            ),
            workflow_thread_id=row["workflow_thread_id"],
            policy_proposal=(NaturalLanguagePolicyProposal.model_validate_json(row["policy_proposal_json"]) if row["policy_proposal_json"] else None),
            confirmed_policy=(ReconciliationPolicy.model_validate_json(row["confirmed_policy_json"]) if row["confirmed_policy_json"] else None),
            policy_validation=(NaturalLanguagePolicyProposal.model_validate_json(row["policy_proposal_json"]).validation if row["policy_proposal_json"] else None),
            policy_workflow_thread_id=row["policy_workflow_thread_id"],
            tolerance_summary=(ToleranceReconciliationSummary.model_validate_json(row["tolerance_summary_json"]) if row["tolerance_summary_json"] else None),
            near_match_analysis=(NearMatchAnalysis.model_validate_json(row["near_match_analysis_json"]) if row["near_match_analysis_json"] else None),
            near_match_summary=(NearMatchReconciliationSummary.model_validate_json(row["near_match_summary_json"]) if row["near_match_summary_json"] else None),
            near_workflow_thread_id=row["near_workflow_thread_id"],
            summary=(
                ReconciliationSummary.model_validate_json(row["summary_json"])
                if row["summary_json"]
                else None
            ),
            client_profile_id=UUID(row["client_profile_id"]) if row["client_profile_id"] else None,
            profile_version=int(row["profile_version"]) if row["profile_version"] else None,
        )

    def save_file(self, reconciliation_id: UUID, file: UploadedFile) -> None:
        field = (
            "government_file_json"
            if file.role == DatasetRole.GOVERNMENT
            else "purchase_register_file_json"
        )
        counterpart_field = (
            "purchase_register_file_json"
            if file.role == DatasetRole.GOVERNMENT
            else "government_file_json"
        )
        now = utc_now().isoformat()
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                f"""UPDATE reconciliations
                SET {field} = ?,
                    mapping_proposal_json = NULL,
                    confirmed_mapping_json = NULL,
                    mapping_validation_json = NULL,
                    workflow_thread_id = NULL,
                    policy_proposal_json = NULL,
                    confirmed_policy_json = NULL,
                    policy_validation_json = NULL,
                    policy_workflow_thread_id = NULL,
                    tolerance_summary_json = NULL,
                    conflicts_json = NULL,
                    near_match_analysis_json = NULL,
                    near_match_summary_json = NULL,
                    near_workflow_thread_id = NULL,
                    summary_json = NULL,
                    status = CASE
                        WHEN {counterpart_field} IS NOT NULL THEN ?
                        ELSE ?
                    END,
                    updated_at = ?
                WHERE id = ?""",
                (
                    file.model_dump_json(),
                    SessionStatus.READY.value,
                    SessionStatus.FILES_PENDING.value,
                    now,
                    str(reconciliation_id),
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.execute("DELETE FROM semantic_classifications WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.execute("DELETE FROM copilot_messages WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.commit()

    def save_mapping_proposal(
        self,
        reconciliation_id: UUID,
        proposal: SchemaMappingProposal,
        workflow_thread_id: str,
    ) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """UPDATE reconciliations
                SET mapping_proposal_json = ?, mapping_validation_json = ?,
                    confirmed_mapping_json = NULL, workflow_thread_id = ?,
                    policy_proposal_json = NULL, confirmed_policy_json = NULL,
                    policy_validation_json = NULL, policy_workflow_thread_id = NULL,
                    tolerance_summary_json = NULL, conflicts_json = NULL,
                    near_match_analysis_json = NULL, near_match_summary_json = NULL,
                    near_workflow_thread_id = NULL,
                    status = ?, updated_at = ? WHERE id = ?""",
                (
                    proposal.model_dump_json(),
                    proposal.validation.model_dump_json(),
                    workflow_thread_id,
                    SessionStatus.AWAITING_MAPPING_APPROVAL.value,
                    utc_now().isoformat(),
                    str(reconciliation_id),
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.execute("DELETE FROM semantic_classifications WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.execute("DELETE FROM copilot_messages WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.commit()

    def save_confirmed_mapping(
        self, reconciliation_id: UUID, mapping: ConfirmedMappingSet
    ) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """UPDATE reconciliations
                SET confirmed_mapping_json = ?, status = ?, updated_at = ? WHERE id = ?""",
                (
                    mapping.model_dump_json(),
                    SessionStatus.MAPPING_CONFIRMED.value,
                    utc_now().isoformat(),
                    str(reconciliation_id),
                ),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.execute("DELETE FROM semantic_classifications WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.execute("DELETE FROM copilot_messages WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.commit()

    def save_policy_proposal(
        self, reconciliation_id: UUID, proposal: NaturalLanguagePolicyProposal, workflow_thread_id: str
    ) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """UPDATE reconciliations SET policy_proposal_json = ?, policy_validation_json = ?,
                confirmed_policy_json = NULL, policy_workflow_thread_id = ?, tolerance_summary_json = NULL,
                conflicts_json = NULL, near_match_analysis_json = NULL,
                near_match_summary_json = NULL, near_workflow_thread_id = NULL,
                status = ?, updated_at = ? WHERE id = ?""",
                (proposal.model_dump_json(), proposal.validation.model_dump_json(), workflow_thread_id,
                 SessionStatus.AWAITING_POLICY_APPROVAL.value, utc_now().isoformat(), str(reconciliation_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.execute("DELETE FROM semantic_classifications WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.execute("DELETE FROM copilot_messages WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.commit()

    def save_confirmed_policy(self, reconciliation_id: UUID, policy: ReconciliationPolicy) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """UPDATE reconciliations SET confirmed_policy_json = ?, policy_proposal_json = ?,
                status = ?, updated_at = ? WHERE id = ?""",
                (policy.model_dump_json(),
                 NaturalLanguagePolicyProposal(
                     reconciliation_id=reconciliation_id,
                     policy=policy,
                     validation=PolicyValidationResult(valid=True),
                 ).model_dump_json(),
                 SessionStatus.POLICY_CONFIRMED.value, utc_now().isoformat(), str(reconciliation_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.commit()

    def update_status(self, reconciliation_id: UUID, status: SessionStatus) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                "UPDATE reconciliations SET status = ?, updated_at = ? WHERE id = ?",
                (status.value, utc_now().isoformat(), str(reconciliation_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.commit()

    def save_results(
        self,
        reconciliation_id: UUID,
        matches: list[MatchResult],
        summary: ReconciliationSummary,
    ) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "DELETE FROM match_results WHERE reconciliation_id = ?",
                (str(reconciliation_id),),
            )
            connection.execute("DELETE FROM semantic_classifications WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.execute("DELETE FROM copilot_messages WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.executemany(
                """INSERT INTO match_results(
                    reconciliation_id, government_record_id, purchase_register_record_id, payload_json
                ) VALUES (?, ?, ?, ?)""",
                [
                    (
                        str(reconciliation_id),
                        match.government_record_id,
                        match.purchase_register_record_id,
                        match.model_dump_json(),
                    )
                    for match in matches
                ],
            )
            connection.execute(
                """UPDATE reconciliations SET status = ?, summary_json = ?,
                tolerance_summary_json = NULL, conflicts_json = NULL,
                near_match_analysis_json = NULL, near_match_summary_json = NULL,
                near_workflow_thread_id = NULL, updated_at = ? WHERE id = ?""",
                (
                    SessionStatus.COMPLETED.value,
                    summary.model_dump_json(),
                    utc_now().isoformat(),
                    str(reconciliation_id),
                ),
            )
            connection.commit()

    def save_near_analysis(
        self, reconciliation_id: UUID, analysis: NearMatchAnalysis,
        workflow_thread_id: str, summary: NearMatchReconciliationSummary,
    ) -> None:
        with closing(self._connect()) as connection:
            cursor = connection.execute(
                """UPDATE reconciliations SET near_match_analysis_json = ?, near_match_summary_json = ?,
                near_workflow_thread_id = ?, status = ?, updated_at = ? WHERE id = ?""",
                (analysis.model_dump_json(), summary.model_dump_json(), workflow_thread_id,
                 SessionStatus.AWAITING_NEAR_MATCH_APPROVAL.value, utc_now().isoformat(), str(reconciliation_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.commit()

    def save_near_state(
        self, reconciliation_id: UUID, analysis: NearMatchAnalysis,
        matches: list[MatchResult], summary: NearMatchReconciliationSummary,
    ) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "DELETE FROM match_results WHERE reconciliation_id = ? AND json_extract(payload_json, '$.match_type') = 'near'",
                (str(reconciliation_id),),
            )
            connection.executemany(
                """INSERT INTO match_results(reconciliation_id, government_record_id,
                purchase_register_record_id, payload_json) VALUES (?, ?, ?, ?)""",
                [(str(reconciliation_id), item.government_record_id,
                  item.purchase_register_record_id, item.model_dump_json()) for item in matches],
            )
            pending = any(item.status.value == "NEAR_MATCH_PROPOSED" for item in analysis.candidates)
            connection.execute(
                """UPDATE reconciliations SET near_match_analysis_json = ?, near_match_summary_json = ?,
                status = ?, updated_at = ? WHERE id = ?""",
                (analysis.model_dump_json(), summary.model_dump_json(),
                 SessionStatus.AWAITING_NEAR_MATCH_APPROVAL.value if pending else SessionStatus.COMPLETED.value,
                 utc_now().isoformat(), str(reconciliation_id)),
            )
            connection.commit()

    def save_near_bulk_approval(
        self, reconciliation_id: UUID, analysis: NearMatchAnalysis,
        matches: list[MatchResult], summary: NearMatchReconciliationSummary,
        events: list[AgentEvent],
    ) -> None:
        """Persist the complete bulk decision and its audit trail atomically."""
        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "DELETE FROM match_results WHERE reconciliation_id = ? AND json_extract(payload_json, '$.match_type') = 'near'",
                (str(reconciliation_id),),
            )
            connection.executemany(
                """INSERT INTO match_results(reconciliation_id, government_record_id,
                purchase_register_record_id, payload_json) VALUES (?, ?, ?, ?)""",
                [(str(reconciliation_id), item.government_record_id,
                  item.purchase_register_record_id, item.model_dump_json()) for item in matches],
            )
            pending = any(item.status == CandidateStatus.NEAR_MATCH_PROPOSED for item in analysis.candidates)
            cursor = connection.execute(
                """UPDATE reconciliations SET near_match_analysis_json = ?, near_match_summary_json = ?,
                status = ?, updated_at = ? WHERE id = ?""",
                (analysis.model_dump_json(), summary.model_dump_json(),
                 SessionStatus.AWAITING_NEAR_MATCH_APPROVAL.value if pending else SessionStatus.COMPLETED.value,
                 utc_now().isoformat(), str(reconciliation_id)),
            )
            if cursor.rowcount != 1:
                raise KeyError(str(reconciliation_id))
            connection.executemany(
                "INSERT INTO audit_events(id, reconciliation_id, timestamp, payload_json) VALUES (?, ?, ?, ?)",
                [(str(event.id), str(event.reconciliation_id), event.timestamp.isoformat(),
                  event.model_dump_json()) for event in events],
            )
            connection.commit()

    def add_event(self, event: AgentEvent) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "INSERT INTO audit_events(id, reconciliation_id, timestamp, payload_json) VALUES (?, ?, ?, ?)",
                (
                    str(event.id),
                    str(event.reconciliation_id),
                    event.timestamp.isoformat(),
                    event.model_dump_json(),
                ),
            )
            connection.commit()

    def list_match_results(self, reconciliation_id: UUID) -> list[MatchResult]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT payload_json FROM match_results WHERE reconciliation_id = ? ORDER BY government_record_id",
                (str(reconciliation_id),),
            ).fetchall()
        return [MatchResult.model_validate_json(row["payload_json"]) for row in rows]

    def save_tolerance_results(
        self,
        reconciliation_id: UUID,
        matches: list[MatchResult],
        conflicts: list[MatchConflict],
        summary: ToleranceReconciliationSummary,
    ) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                "DELETE FROM match_results WHERE reconciliation_id = ? AND json_extract(payload_json, '$.match_type') IN ('tolerance', 'near')",
                (str(reconciliation_id),),
            )
            connection.execute("DELETE FROM semantic_classifications WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.execute("DELETE FROM copilot_messages WHERE reconciliation_id = ?", (str(reconciliation_id),))
            connection.executemany(
                """INSERT INTO match_results(reconciliation_id, government_record_id,
                purchase_register_record_id, payload_json) VALUES (?, ?, ?, ?)""",
                [(str(reconciliation_id), item.government_record_id,
                  item.purchase_register_record_id, item.model_dump_json()) for item in matches],
            )
            connection.execute(
                """UPDATE reconciliations SET status = ?, tolerance_summary_json = ?,
                conflicts_json = ?, near_match_analysis_json = NULL,
                near_match_summary_json = NULL, near_workflow_thread_id = NULL,
                updated_at = ? WHERE id = ?""",
                (SessionStatus.COMPLETED.value, summary.model_dump_json(),
                 json.dumps([item.model_dump(mode="json") for item in conflicts]),
                 utc_now().isoformat(), str(reconciliation_id)),
            )
            connection.commit()

    def list_conflicts(self, reconciliation_id: UUID) -> list[MatchConflict]:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT conflicts_json FROM reconciliations WHERE id = ?", (str(reconciliation_id),)
            ).fetchone()
        return [MatchConflict.model_validate(item) for item in json.loads(row["conflicts_json"] or "[]")] if row else []

    def list_events(self, reconciliation_id: UUID | None = None, limit: int = 50) -> list[AgentEvent]:
        with closing(self._connect()) as connection:
            if reconciliation_id is None:
                rows = connection.execute(
                    "SELECT payload_json FROM audit_events ORDER BY timestamp DESC LIMIT ?",
                    (limit,),
                ).fetchall()
            else:
                rows = connection.execute(
                    """SELECT payload_json FROM audit_events
                    WHERE reconciliation_id = ? ORDER BY timestamp DESC LIMIT ?""",
                    (str(reconciliation_id), limit),
                ).fetchall()
        return [AgentEvent.model_validate_json(row["payload_json"]) for row in rows]

    def save_semantic_classification(self, classification: SemanticClassification) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO semantic_classifications(reconciliation_id, record_id, payload_json, updated_at)
                VALUES (?, ?, ?, ?) ON CONFLICT(reconciliation_id, record_id) DO UPDATE SET
                payload_json = excluded.payload_json, updated_at = excluded.updated_at""",
                (str(classification.reconciliation_id), classification.record_id,
                 classification.model_dump_json(), classification.updated_at.isoformat()),
            )
            connection.commit()

    def list_semantic_classifications(self, reconciliation_id: UUID) -> list[SemanticClassification]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                "SELECT payload_json FROM semantic_classifications WHERE reconciliation_id = ? ORDER BY record_id",
                (str(reconciliation_id),),
            ).fetchall()
        return [SemanticClassification.model_validate_json(row["payload_json"]) for row in rows]

    def save_copilot_message(self, message: CopilotMessage) -> None:
        if message.reconciliation_id is None:
            return
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO copilot_messages(id, reconciliation_id, conversation_id, created_at, payload_json)
                VALUES (?, ?, ?, ?, ?)""",
                (str(message.id), str(message.reconciliation_id), str(message.conversation_id),
                 message.created_at.isoformat(), message.model_dump_json()),
            )
            connection.commit()

    def list_copilot_messages(
        self, reconciliation_id: UUID | None, conversation_id: UUID, limit: int = 40,
    ) -> list[CopilotMessage]:
        if reconciliation_id is None:
            return []
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT payload_json FROM copilot_messages WHERE reconciliation_id = ?
                AND conversation_id = ? ORDER BY created_at DESC LIMIT ?""",
                (str(reconciliation_id), str(conversation_id), limit),
            ).fetchall()
        return [CopilotMessage.model_validate_json(row["payload_json"]) for row in reversed(rows)]

    def save_human_selected_match(
        self, reconciliation_id: UUID, match: MatchResult,
        summary: NearMatchReconciliationSummary, analysis: NearMatchAnalysis,
    ) -> None:
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO match_results(reconciliation_id, government_record_id,
                purchase_register_record_id, payload_json) VALUES (?, ?, ?, ?)""",
                (str(reconciliation_id), match.government_record_id,
                 match.purchase_register_record_id, match.model_dump_json()),
            )
            connection.execute(
                """UPDATE reconciliations SET near_match_analysis_json = ?, near_match_summary_json = ?,
                status = ?, updated_at = ? WHERE id = ?""",
                (analysis.model_dump_json(), summary.model_dump_json(), SessionStatus.COMPLETED.value,
                 utc_now().isoformat(), str(reconciliation_id)),
            )
            connection.commit()

    def save_ai_investigation(self, investigation: AIInvestigationRecord) -> None:
        """Append an immutable investigation record; existing rows are never replaced."""
        with closing(self._connect()) as connection:
            connection.execute(
                """INSERT INTO ai_investigations(
                id, reconciliation_id, record_id, started_at, payload_json
                ) VALUES (?, ?, ?, ?, ?)""",
                (
                    str(investigation.id),
                    str(investigation.reconciliation_id),
                    investigation.record_id,
                    investigation.started_at.isoformat(),
                    investigation.model_dump_json(),
                ),
            )
            connection.commit()

    def list_ai_investigations(
        self, reconciliation_id: UUID, record_id: str
    ) -> list[AIInvestigationRecord]:
        with closing(self._connect()) as connection:
            rows = connection.execute(
                """SELECT payload_json FROM ai_investigations
                WHERE reconciliation_id = ? AND record_id = ?
                ORDER BY started_at DESC""",
                (str(reconciliation_id), record_id),
            ).fetchall()
        return [AIInvestigationRecord.model_validate_json(row["payload_json"]) for row in rows]
