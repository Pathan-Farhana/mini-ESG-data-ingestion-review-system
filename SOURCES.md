# SOURCES.md: Technical Ingestion Feeds & Field Research
*Breathe ESG — Data Engineering Division*

This index details the real-world operational formats researched to construct our sample data, the environmental mathematics driving normalization, and practical failure points to anticipate in live production.

---

## 1. SAP Fuel & Procurement Feed (`SAP`)

### Real-World Research & Format
SAP materials management tracks fuel using specialized transaction codes. When a plant orders stationary diesel, the procurement department exports ledger movements (similar to standard SAP `MB51` reports) or generates structural **IDocs (Intermediate Documents)** representing materials, plants, dates, and quantities.
* **German Configuration Headers**: Because SAP headquarters is in Walldorf, Germany, default ledger variables often retain German technical names unless custom translations are manually configured:
  - `Menge` = Quantity
  - `Einheit` = Unit
  - `Werk` = Plant code
  - `Buchungsdatum` = Posting Date (formatted as `DD.MM.YYYY` instead of international standards)

### Real-World Sample Record Mappings
```json
{
  "IDoc_Num": "IDOC-SAP-1011",
  "Ref_Po": "PO-2026-9092",
  "Material": "MAT-DSL-001",
  "Menge": "12.500,00",
  "Einheit": "L",
  "Werk": "DE_PL_102",
  "Buchungsdatum": "24.04.2026",
  "Tenant_Id": "Breathe_Enterprise_Tenant_01"
}
```
* **Why it looks this way**: Displays typical European syntax:
  - Space separators or decimal commas in `Menge` (e.g. `12.500,00`).
  - Unit `L` indicating Liters.
  - Standard German plant structure (`DE_PL_102`).

### Live Deployment Risks & Failure Points
1. **Unmapped Materials**: Procurement teams continuously introduce new material SKU numbers. If a vendor introduces a new diesel variant without notifying the ESG team, the normalizer cannot resolve the emissions factor.
2. **Date Parser Crashing**: SAP configurations can format dates in multiple ways depending on user settings (e.g., `YYYYMMDD`, `DD.MM.YYYY`, `MM/DD/YYYY`).

---

## 2. Utility Electricity Feed (`UTILITY`)

### Real-World Research & Format
Facilities managers download billing exports from utility dashboards (like PG&E, TXU Energy, or E.ON). These portals don't align usage with clean calendar durations. A bill can start on April 12 and end on May 11 depending on physical meter reading runs.
Furthermore, physical meters calculate power by multiplying reading differences by a physical constant:
$$\text{Calculated Usage} = (\text{Current Reading} - \text{Previous Reading}) \times \text{Multiplier}$$

### Real-World Sample Record Mappings
```json
{
  "Account_Number": "UTIL-ELEC-40291",
  "Meter_ID": "MET-9910023",
  "Start_Date": "2026-04-12",
  "End_Date": "2026-05-11",
  "Previous_Reading": "102900",
  "Current_Reading": "121900",
  "Multiplier": "1.0",
  "Usage_kWh": "26500",
  "Tariff_Code": "TX_COM_PEAK_B",
  "Tenant_Id": "Breathe_Enterprise_Tenant_01"
}
```
* **Why it looks this way**: Built to test mathematical validations. If an analyst multiplies the reader delta with the multiplier ($121900 - 102900 \times 1 = 19000$), it mismatchs the stated usage of $26500$. The system detects this math anomaly immediately.

### Live Deployment Risks & Failure Points
1. **Meter Replacements**: When physical utility teams replace a burned-out meter, the physical "previous reading" resets to zero, producing a massive false spike in calculated emissions.
2. **Missing Multipliers**: High-voltage industrial plants use current transformers (CT) with multipliers ranging from 40x to 80x. Omitting this multiplier from the database leads to a huge under-reporting of energy usage.

---

## 3. Corporate Travel Feed (`TRAVEL`)

### Real-World Research & Format
Platforms like SAP Concur, Navan, or Egencia export travel data from GDS (Global Distribution System) logs.
* **Flights**: Bookings list airport IATA codes (e.g. `SFO` -> `LHR`) but omit distance metrics. Carbon engines must calculate Great-Circle distance using coordinates.
* **Cabins**: Booking classes map directly to DEFRA/EPA emissions multipliers: Economy (1.0x), Premium Economy (1.6x), and Business Class (2.9x).
* **Hotels**: Emitting footprints are room-night dependent and adjust based on local electrical grid mixes. Staying in Dubai (heavy cooling and desalination demand) emits significantly more carbon per night than staying in Paris (primarily clean nuclear power).

### Real-World Sample Record Mappings
```json
{
  "Booking_Ref": "SFO-LHR-2026",
  "Employee_ID": "EMP-092",
  "Travel_Type": "Flight",
  "Origin_Airport": "SFO",
  "Destination_Airport": "LHR",
  "Cabin_Class": "Business",
  "Spend_Amount_USD": "4500.00",
  "Tenant_Id": "Breathe_Enterprise_Tenant_01"
}
```
* **Why it looks this way**: Features real and recognizable IATA identifiers. Features cabin indicators to trigger business-class density multipliers.

### Live Deployment Risks & Failure Points
1. **New Airfields**: Brand new municipal airfields will fail coordinate lookup structures if the local coordinates database is not maintained.
2. **Overlapping Expenses**: Real-world travelers combine flights, hotels, and rentals in a single receipt. Parsing engines must cleanly categorize these to apply the correct emission factors.
