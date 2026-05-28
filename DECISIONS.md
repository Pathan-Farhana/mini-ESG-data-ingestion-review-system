# DECISIONS.md: Strategic Decisions & Product Resolutions 
*Breathe ESG — Corporate Ingestion Ledger Prototype Design*

Below is a summary of the technical choices made during the architectural mapping of the Breathe ESG ingestion prototype.

---

## 1. Scope Boundaries: Ingestion Selection

### Source 1: SAPFuel & Procurement Exports
* **Selected Mode**: **SAP flat-file CSV export** structured from standard SAP custom ALV grids (Standard T-Codes like `MB51` or `J3GD`).
* **Justification**: Clients rarely grant complete custom REST/OData VPN credentials to their SAP core tables in early onboarding. CSV exports with standard German headers are the realistic starting gate.
* **What is Handled**:
  - Comma/dot notations clean-up (e.g., German syntax `"15.000,00"` mapped to `"15000.00"`).
  - Material code lookups mapped automatically to either stationary fuels (Diesel), mobile fleets, or spend-based Categories (Office Supplies).
  - Plant facility lookups (`Werk` codes like `DE_PL_102`) matched to local environmental coordinates and grid mix factors.
* **What is Ignored**:
  - We ignored raw IDoc binary segment parse runs as they require separate middleware services that bloat the prototype without providing analyst UX advantages.

### Source 2: Utility Electricity Ingestion
* **Selected Mode**: **Utility portal standard export CSV files**. Uses readings difference combined with meter constraints.
* **Justification**: Utilities rarely provide real-time APIs; facilities teams use portal scraping tools or download CSV files.
* **What is Handled**:
  - Prev/Current reading delta validations.
  - Multiplier multiplication verification: $\text{Usage} = (Current - Previous) \times Multiplier$. Mismatches between stated usage and delta math trigger high-severity audit WARNINGS.
  - Time apportioning: Splitting crossed-range bills into clean calendar months.
* **What is Ignored**:
  - Complex multi-tier time-of-use tariffs. We used standard, static regional grid-mix coefficients (e.g., US ERCOT, German grid averages, or Oregon high-hydro clean mixes).

### Source 3: Corporate Travel (Concur/Navan Receipts)
* **Selected Mode**: **Concur GDS Booking Data export** (JSON/CSV representation).
* **Justification**: Navan or Concur travel systems provide deep, reliable transaction exports for carbon profiling.
* **What is Handled**:
  - Distance recalculation: If only airport IATA codes are given (`SFO` -> `LHR`), the engine calculates Great-Circle miles using latitude and longitude mappings.
  - Passenger cabin flight multipliers: Multiplies short/medium/long haul distance by premium cabin adjustments (e.g., Business flights occupy direct volume on planes and carry 2.9x emission factors).
  - Hotel nights calculations tailored by sovereign territory. (Comparing low-carbon grids like France to high-emissions heating grids like the UAE).
* **What is Ignored**:
  - Multi-city layovers. Connecting flights are parsed as a single direct great circle path.

---

## 2. Resolving Ambiguities & Edge-Case Decisions

### A. How do we treat files with corrupt data rows?
* *Choice*: Never reject the entire bulk file. If 1 row out of 100 has a missing material mapping, we ingest the row, set standard quantities to zero or a rough spend-based fallback, and register high-priority `ERROR` indicators inside the `issues` attribute.
* *Why*: If a system rejects a whole file because of a simple typo, the analyst loses visibility. By continuing to register the row as "PENDING" but tagging errors clearly in red, the analyst can edit and fix it directly inside the browser.

### B. What is the boundary on manual edits?
* *Choice*: Analysts can override values but can **never delete rows**. Every edit triggers a complete recompute through the normalization engine, logging the user ID, timestamp, and a snapshot of changed fields.
* *Why*: Auditors must be able to verify why a number changed from the raw feed. An immutable audit trail prevents human manipulation and provides transparency.

---

## 3. Top Questions for the PM

If we could review the product timeline, here is what we would ask:

1. **How do client sustainability teams resolve unmapped SAP Materials?** 
   - Should our AI agent suggest close matches, or should we route them to a centralized company dictionary?
2. **Do utility meters have smart-meter interval feeds?**
   - If clients start uploading 15-minute interval files instead of monthly bills, the calendar apportioning logic can be deactivated in favor of simple aggregation.
3. **What is the approval and auditing cycle?**
   - Do audits happen quarterly or annually? Once an analyst approves a row, can a legal team unlock it under secondary permissions, or is it permanently static?
