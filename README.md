# infojob
InfoJOB is a Chrome extension that automates INFOJUD queries on Brazil's eCAC tax portal, designed for Brazilian Judiciary employees. It enables batch processing of judicial cases, automatic document downloading, and organized file management.
# InfoJOB

> Chrome extension for automating INFOJUD queries on Brazil's eCAC tax portal, designed exclusively for Brazilian Judiciary employees.

---

## Overview

**InfoJOB** automates the process of submitting batch requests to the **INFOJUD** system on the Brazilian Federal Revenue's **eCAC** portal.

Instead of filling out forms manually for each case, authorized Judiciary employees can import a spreadsheet with multiple judicial cases and have all requests submitted automatically, saving hours of repetitive work.

---

## Features

- Import `.xlsx` and `.ods` spreadsheets with judicial case data
- Automatic batch submission of INFOJUD requests
- Automatic download and renaming of received documents
- Organized file storage with configurable output folder
- Automatic generation of informational PDFs (DITR, DIPJ, Info. Cadastrais)
- Integrated user guide accessible via the help button

---

## Supported Query Types

| Type | Description | Entity |
|------|-------------|--------|
| DIRPF | Annual income tax declaration | CPF |
| DITR | Rural property tax declaration | CPF / CNPJ |
| DOI | Real estate transactions | CPF / CNPJ |
| DECRED | Credit card transactions | CPF / CNPJ |
| DIMOB | Real estate business activities | CPF / CNPJ |
| eFinanceira | Bank accounts and investments | CPF / CNPJ |
| ECF | Corporate income tax (2015+) | CNPJ |
| DIPJ | Corporate income tax (until 2014) | CNPJ |
| Info. Cadastrais | Taxpayer registration data | CPF / CNPJ |

---

## Installation

> **Note:** This extension is distributed as unlisted on the Chrome Web Store and is intended for internal use by Brazilian Judiciary employees with valid INFOJUD access credentials.

1. Download the latest release ZIP from the [Releases](https://github.com/Rodrigo-Madalosso-Araujo/infojob/releases) page
2. Extract the ZIP to a **permanent folder** on your computer
3. Open Chrome and navigate to `chrome://extensions`
4. Enable **Developer mode** (top right toggle)
5. Click **Load unpacked** and select the extracted folder
6. The InfoJOB lion icon will appear in your browser toolbar

---

## How to Use

1. Log in to [eCAC](https://cav.receita.fazenda.gov.br) with your GOV.BR digital certificate
2. Navigate to the **INFOJUD** system
3. Click the InfoJOB icon in the toolbar
4. Select your spreadsheet (`.xlsx` or `.ods`)
5. Configure column mapping and starting row
6. Click **Execute automation**
7. When responses arrive in the eCAC mailbox, click **Save responses**

For detailed instructions, download the [User Guide](./InfoJOB_Guia_do_Usuario.pdf).

---

## Configuration

| Setting | Description |
|---------|-------------|
| Court | Exact name as shown in the eCAC dropdown |
| Process type | e.g., Acao Trabalhista, Execucao Fiscal |
| Justification | Default justification text for all requests |
| Output folder | Subfolder name inside your Downloads folder |
| Column mapping | Configure spreadsheet columns for process number, name and CPF/CNPJ |

---

## Privacy & Security

- **No data collection** - the extension does not store, share, or transmit any personal or case data to third parties
- **Local processing only** - all automation occurs between the user's browser and the Federal Revenue servers
- **No AI** - no artificial intelligence or machine learning is used
- **LGPD compliant** - fully compliant with Brazil's General Data Protection Law

For full details, see the [Privacy Policy](./InfoJOB_Politica_de_Privacidade.docx).

---

## Repository Contents

| File | Description |
|------|-------------|
| `InfoJOB_Guia_do_Usuario.pdf` | Complete user guide (Portuguese) |
| `InfoJOB_Politica_de_Privacidade.docx` | Privacy policy |
| `InfoJOB_Justificativas_ChromeStore.docx` | Chrome Web Store permission justifications |

---

## Authors

Developed by Brazilian Judiciary employees, for Brazilian Judiciary employees - non-profit, with dedication.

- **Rodrigo Madalosso Araujo** - <rodrigo.araujo@trt18.jus.br>
- **Leandro Vinicius de Magalhaes Rodrigues** - <leandro.rodrigues@trt19.jus.br>

---

## License

[MIT License](./LICENSE) - Free to use, modify and distribute.

---

*InfoJOB v2.1 - Developed for the Brazilian Judiciary*
