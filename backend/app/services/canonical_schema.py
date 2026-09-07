from __future__ import annotations

from app.domain.models import CanonicalDataType, CanonicalFieldDefinition


CANONICAL_FIELD_DEFINITIONS: tuple[CanonicalFieldDefinition, ...] = (
    CanonicalFieldDefinition(
        canonical_name="record_id",
        display_name="Record ID",
        description="Stable source-row identifier used for traceability.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=False,
        required_for_exact_match=True,
        aliases=[
            "record id", "government record id", "pr record id", "row id",
            "source row key", "transaction id", "line id",
        ],
    ),
    CanonicalFieldDefinition(
        canonical_name="gstin",
        display_name="GSTIN",
        description="Supplier or counterparty GST registration number.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=[
            "gstin", "ctin", "vendor gstin", "supplier gstin", "supplier tax id",
            "party reg no", "tax registration no", "counterparty gstin",
        ],
    ),
    CanonicalFieldDefinition(
        canonical_name="document_number",
        display_name="Invoice number",
        description="Supplier invoice or source document reference.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=[
            "document number", "invoice number", "inum", "ref no", "reference no",
            "voucher ref", "external ref", "pr document number", "counterparty document number",
        ],
    ),
    CanonicalFieldDefinition(
        canonical_name="document_date",
        display_name="Document date",
        description="Invoice, posting, or source document date.",
        expected_datatype=CanonicalDataType.DATE,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=[
            "document date", "invoice date", "idt", "posting dt", "posting date",
            "voucher dt", "accounting dt", "pr document date", "counterparty document date",
        ],
    ),
    CanonicalFieldDefinition(
        canonical_name="document_type",
        display_name="Document type",
        description="Invoice, credit note, debit note, or related document classification.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=["document type", "doc type", "transaction type", "txn category", "voucher type"],
    ),
    CanonicalFieldDefinition(
        canonical_name="taxable_value",
        display_name="Taxable value",
        description="Value on which GST is calculated before tax.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=[
            "taxable value", "txval", "base amt", "base amount", "assessable amt",
            "assessable amount", "net assessable",
        ],
    ),
    CanonicalFieldDefinition(
        canonical_name="gst_rate",
        display_name="GST rate",
        description="Applicable GST percentage rate.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=["gst rate", "tax rate", "tax pct", "gst percent", "rate"],
    ),
    CanonicalFieldDefinition(
        canonical_name="document_value",
        display_name="Document value",
        description="Gross document value including applicable tax and charges.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=False,
        aliases=["document value", "invoice value", "gross document value", "gross invoice value"],
    ),
    CanonicalFieldDefinition(
        canonical_name="igst",
        display_name="IGST",
        description="Integrated GST amount.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=["igst", "igst amount", "iamt", "input igst", "integrated tax"],
    ),
    CanonicalFieldDefinition(
        canonical_name="cgst",
        display_name="CGST",
        description="Central GST amount.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=["cgst", "cgst amount", "camt", "input cgst", "central tax"],
    ),
    CanonicalFieldDefinition(
        canonical_name="sgst",
        display_name="SGST",
        description="State GST amount.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=["sgst", "sgst amount", "samt", "input sgst", "state tax"],
    ),
    CanonicalFieldDefinition(
        canonical_name="cess",
        display_name="Cess",
        description="Compensation cess amount.",
        expected_datatype=CanonicalDataType.NUMBER,
        participates_in_matching=True,
        required_for_exact_match=True,
        aliases=["cess", "cess amount", "csamt", "input cess", "compensation levy"],
    ),
    CanonicalFieldDefinition(
        canonical_name="counterparty_name",
        display_name="Counterparty name",
        description="Supplier or counterparty display name.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=False,
        aliases=["counterparty name", "vendor name", "supplier name", "party name"],
    ),
    CanonicalFieldDefinition(
        canonical_name="narration",
        display_name="Narration",
        description="Free-text transaction narration or memo.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=False,
        aliases=["narration", "description", "memo", "remarks"],
    ),
    CanonicalFieldDefinition(
        canonical_name="return_period",
        display_name="Return period",
        description="GST return period associated with the record.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=False,
        aliases=["return period", "tax period", "filing period"],
    ),
    CanonicalFieldDefinition(
        canonical_name="filing_status",
        display_name="Filing status",
        description="Government filing status for the source transaction.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=False,
        aliases=["filing status", "return status"],
    ),
    CanonicalFieldDefinition(
        canonical_name="itc_eligibility",
        display_name="ITC eligibility",
        description="Input tax credit eligibility classification.",
        expected_datatype=CanonicalDataType.STRING,
        participates_in_matching=False,
        aliases=["itc eligibility", "input credit eligibility", "credit eligibility"],
    ),
)

CANONICAL_BY_NAME = {field.canonical_name: field for field in CANONICAL_FIELD_DEFINITIONS}
REQUIRED_EXACT_FIELDS = tuple(
    field.canonical_name for field in CANONICAL_FIELD_DEFINITIONS if field.required_for_exact_match
)
