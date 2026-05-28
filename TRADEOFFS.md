# TRADEOFFS.md: Technical Tradeoffs & Architectural Postponements
*Breathe ESG — Product Engineering Board*

To ensure a highly secure, reliable, and functional prototype within our 4-day timeline, we deliberately omitted three complex enterprise subsystems. Below we justify these trade-offs.

---

## 1. Automated PDF OCR parsing pipeline for utility bills
* **What it would be**: A computer-vision service (like AWS Textract or Document AI) that takes raw utility PDF scraps, runs optical character recognition (OCR), and maps layout geometries to extract meter readings.
* **Why we did not build it**: OCR is highly brittle. Utility portals change layouts constantly, and minor extraction errors (e.g., misreading a decimal point or reading a "9" as an "8") lead to serious audit compliance issues. 
* **The Tradeoff Choice**: Facilities teams already have access to CSV portal exports or manual meter spreadsheets. By supporting CSV ingestion and an analyst edit console, we solve the data capture problem reliably and securely. We can build specialized OCR templates as a secondary optimization phase.

---

## 2. Direct 2-Way SAP RFC/BAPI VPN integration
* **What it would be**: Direct integration with standard SAP R/3 or S/4HANA systems via SAP GUI RFC (Remote Function Calls) or OData web-services inside a corporate VPN.
* **Why we did not build it**: Establishing corporate firewall openings, provisioning technical users, and negotiating with corporate IT security (SecOps) takes months of planning. Building direct connection code in a prototype is impossible to test or demonstrate.
* **The Tradeoff Choice**: Real-world SAP transactions can be exported to standard CSV files. Ingesting these files represents the optimal balance, keeping the app independent and highly secure.

---

## 3. Real-Time Ecoinvent / DEFRA API synchronization
* **What it would be**: Making external REST requests to paid third-party carbon factor databases (like Climatiq, Ecoinvent, or UK DEFRA) at execution runtime for every single ESG row.
* **Why we did not build it**: Live API calls create severe auditing risks. If a remote factor database alters its coefficient for stationary diesel in the middle of a reporting period, client numbers will fluctuate dynamically. This makes reproducibility impossible.
* **The Tradeoff Choice**: We hard-coded reliable, audited, and static regional grids and fuel emission factors directly inside our `/src/emissionsMath.ts` engine. This ensures the calculation formula is local, deterministic, and easily inspectable by financial-grade auditors.
