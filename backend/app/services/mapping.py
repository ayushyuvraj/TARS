from __future__ import annotations

from app.domain.models import ColumnMapping, DatasetRole

CANONICAL_FIELDS = (
    "record_id",
    "gstin",
    "document_number",
    "document_date",
    "document_type",
    "taxable_value",
    "gst_rate",
    "igst",
    "cgst",
    "sgst",
    "cess",
)

CANONICAL_MAPPINGS: dict[DatasetRole, dict[str, str]] = {
    DatasetRole.GOVERNMENT: {
        "record_id": "Government_Record_ID",
        "gstin": "Counterparty_GSTIN",
        "document_number": "Counterparty_Document_Number",
        "document_date": "Counterparty_Document_Date",
        "document_type": "Document_Type",
        "taxable_value": "Taxable_Value",
        "gst_rate": "GST_Rate",
        "igst": "IGST_Amount",
        "cgst": "CGST_Amount",
        "sgst": "SGST_Amount",
        "cess": "Cess_Amount",
    },
    DatasetRole.PURCHASE_REGISTER: {
        "record_id": "PR_Record_ID",
        "gstin": "Vendor_GSTIN",
        "document_number": "PR_Document_Number",
        "document_date": "PR_Document_Date",
        "document_type": "Document_Type",
        "taxable_value": "Taxable_Value",
        "gst_rate": "GST_Rate",
        "igst": "IGST_Amount",
        "cgst": "CGST_Amount",
        "sgst": "SGST_Amount",
        "cess": "Cess_Amount",
    },
}


def mappings_for(role: DatasetRole) -> list[ColumnMapping]:
    return [
        ColumnMapping(canonical_field=field, source_column=source)
        for field, source in CANONICAL_MAPPINGS[role].items()
    ]

