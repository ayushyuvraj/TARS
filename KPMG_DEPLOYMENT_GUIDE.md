# TARS — KPMG Environment Deployment & User Guide

**GST Agentic Reconciliation Workbench**  
*Enterprise On-Premises Handover Package for KPMG*

---

## 1. System Requirements & Prerequisites

Before running the application on your KPMG laptop or virtual workstation, please ensure the following runtimes are installed:

### A. Python 3.11+ (64-bit)
* **Required Version**: Python 3.11.x, 3.12.x, or 3.13.x (64-bit).
* **How to verify**: Open Command Prompt (`cmd`) or PowerShell and execute:
  ```cmd
  python --version
  ```
  The output must show `Python 3.11.x` or higher.
* **Installation Notes for KPMG Corporate Laptops**:
  1. Open the **KPMG Software Center** or **Company Portal** on your machine.
  2. Search for **Python 3.11 (64-bit)** or **Python 3.12 (64-bit)** and click Install.
  3. If downloading from [python.org](https://www.python.org/downloads/windows/), download the **Windows installer (64-bit)**.
  4. ⚠️ **CRITICAL INSTALL STEP**: On the very first screen of the Python installer, check the box:  
     ☑ **"Add python.exe to PATH"**  
     *(If this is omitted, Windows terminal scripts cannot locate Python).*

### B. Node.js 20+ LTS
* **Required Version**: Node.js 20.x LTS or higher (includes `npm`).
* **How to verify**: Open Command Prompt and execute:
  ```cmd
  node -v
  npm -v
  ```
* **Installation Notes for KPMG Corporate Laptops**:
  1. Search for **Node.js LTS** in KPMG Software Center.
  2. Or download the standard 64-bit `.msi` from [nodejs.org](https://nodejs.org/).

### C. Web Browser
* Google Chrome, Microsoft Edge, or Mozilla Firefox.

---

## 2. Quick Start: One-Touch Launch

### The One-Touch Experience
Simply extract the ZIP package and double-click:
👉 **`START_TARS.bat`** (or `run.bat`)

The launcher automatically:
1. **Detects your Python 3.11+ runtime** (probing PATH and enterprise Software Center directories).
2. **Initializes an isolated virtual environment** (`.venv`).
3. **Installs all Python dependencies** from `backend/requirements.txt` (with auto-fallback for corporate firewall/proxy).
4. **Verifies the pre-compiled enterprise UI** (FastAPI serves the React web interface directly on port 8000 — **zero Node.js/npm required** on your laptop).
5. **Boots the TARS engine and launches your default browser at:**  
   👉 **`http://127.0.0.1:8000`**

*(To shut down TARS cleanly at any time, return to the launcher window and press any key, or double-click `stop_app.bat`).*

---

## 3. OpenAI & Azure OpenAI Configuration

TARS preserves 100% of its native capabilities, including the Katalyst Copilot, LLM-driven schema mapping, forensic investigations, and token cost tracking.

Open the `.env` file in the project root:

```env
# Core Configuration
APP_ENV=production
DATABASE_PATH=data/gst_reconciliation.db
UPLOAD_DIR=data/uploads
EXPORT_DIR=data/exports
FRONTEND_ORIGIN=http://localhost:5173

# LLM Provider Configuration
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-your-openai-api-key-here
OPENAI_MODEL=gpt-5.4-mini
```

### Enterprise Gateway / Azure OpenAI Notes:
* If your KPMG team uses an **Azure OpenAI** or internal proxy gateway, configure the base URL in your environment or via `.env`:
  ```env
  OPENAI_BASE_URL=https://<your-kpmg-resource>.openai.azure.com/v1
  OPENAI_API_KEY=<your-azure-key>
  ```
* Supported models: `gpt-5.4-mini`, `gpt-4o`, `gpt-4.1-mini`.
* **Zero Disruption Guarantee**: If no API key is provided, the entire core reconciliation engine (exact matching, tolerance formulas, RapidFuzz near-match, Rules Wiki, Audit 2.0 Ledger, and Excel exports) executes seamlessly using deterministic high-throughput algorithms.

---

## 4. KPMG Corporate Proxy & Firewall Troubleshooting

If your corporate laptop restricts external package downloads through a strict firewall, follow these quick resolutions:

### If `pip` fails during `setup.bat`:
Run the installation specifying your KPMG proxy or trusted hosts:
```cmd
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --proxy http://proxy.kpmg.com:8080
```
Or bypass SSL inspection blocks:
```cmd
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt --trusted-host pypi.org --trusted-host files.pythonhosted.org
```

### If `npm` fails during `setup.bat`:
Configure npm to route through the proxy:
```cmd
npm config set proxy http://proxy.kpmg.com:8080
npm config set https-proxy http://proxy.kpmg.com:8080
```

---

## 5. Demonstration & Testing Guide

This package includes the standard synthetic enterprise sample datasets inside `sample_data/`:

| File Name | Description | Recommended Flow |
| :--- | :--- | :--- |
| `TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx` | 20,000 Rows, 165 Columns Single Unified Workbook | **Reconciliation 3.0 (Single Ledger)** |
| `POC_Government_GST_Aug2026.xlsx` | Government GSTR-2B Portal Export | **Reconciliation 2.0 (Double Ledger)** |
| `POC_Purchase_Register_Aug2026.xlsx` | Client ERP Purchase Register | **Reconciliation 2.0 (Double Ledger)** |
| `POC_Reconciliation_Ground_Truth.xlsx` | Benchmark reconciliation outcome | Verification & Audit comparison |

### Running Reconciliation 3.0 (Single Ledger):
1. In the left navigation menu, hover over **Reconciliation** and click **Single Ledger**.
2. Drag and drop `sample_data/TARS_KIGS_RECON_20000_Rows_All_Scenarios.xlsx` into Stage 1.
3. Review auto-detected symmetric column linkages in Stage 2 (Mapping).
4. Review Section 1 normalizers and Section 2 tolerance formulas in Stage 3 (Rules).
5. Execute Stage 4 (Results) to run the high-speed vectorized waterfall engine across 20,000 rows.
6. Inspect the executive tax dashboard in Stage 5 (Summary).
7. Generate and download the official 5-sheet KIGS audit workbook in Stage 6 (Export).

---

## 6. How to Stop the Application

To shut down TARS:
1. Return to the `run.bat` command prompt window.
2. Press any key to stop all background processes and close the service windows cleanly.
