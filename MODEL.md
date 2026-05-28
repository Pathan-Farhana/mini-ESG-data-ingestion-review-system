# MODEL.md: Data Quality & Normalization Architecture
*Breathe ESG — Corporate Ingestion Ledger Ledger Model*

This document defines the schema design, dimensional entities, multi-tenancy boundaries, and mathematical normalization matrices modeled for client onboarding.

---

## 1. Core Paradigm: The Apportioned Universal Ledger
Enterprise carbon auditing fails when database tables are partitioned into silos for different sources (e.g., a "fuel table", a "utility table", a "flight table"). Analysts cannot audit across streams, grid factor mappings mismatch, and joint reconciliation is impossible. 

Our blueprint establishes a single unified entity: **`NormalizedESGRow`**. 

Every raw ingestion record regardless of source (SAP Flat File, Utility portal scrappings, or Concur Travel GDS receipts) maps cleanly to this unified target schema. This enables a single, reliable audit table layout.

```
       [   SAP IDoc Ingest  ] -----\
       [ Utility Portal CSV ] -----> [ Normalizer & Emissions Engine ] ---> [ Apportioned Universal Ledger ] (Locked rows)
       [ Navan Travel APIs  ] -----/
```

---

## 2. Full Unified Target Schema Schema

The system represents the persistent auditing layer using the following JSON-LD compatible ledger row definition:

```typescript
export interface NormalizedESGRow {
  // 1. Identity & System Tracking Attributes
  id: string;                    // Universally Unique Trace ID (UUID)
  tenantId: string;              // Client enterprise account selector (Multi-tanancy key)
  sourceType: 'SAP' | 'UTILITY' | 'TRAVEL'; // Traceable operational channel
  sourceRowId: string;           // Direct reference identifier pointing back to origin row (IDoc ID, Account Num, PNR Ref)
  status: 'PENDING' | 'REJECTED' | 'APPROVED'; // Operational workflow state
  isLocked: boolean;             // Immutable ledger flag: approved rows are locked forever for auditors
  analystApprovedBy?: string;    // Direct digital sign-off trail
  analystApprovedAt?: string;    // Sign-off date-stamp

  // 2. Greenhouse Gas Protocol Categorization
  scope: 'Scope 1' | 'Scope 2' | 'Scope 3';
  category: string;              // Specific GHG activity code (Stationary Combustion, Business Travel)
  facilityId: string;            // Granular operational entity (e.g. Plant DE_PL_102, Meter MET-991, Regional Division)
  country: string;               // ISO 3166-1 alpha-2 country key (for emission boundaries)

  // 3. Temporal Realignment Metrics
  originalDate: string;          // Extracted record date
  billingPeriodStart?: string;   // Utility billing duration start
  billingPeriodEnd?: string;     // Utility billing duration end
  reportingYear: number;         // Normalized calendar reporting year
  reportingMonth: number;        // Normalized calendar reporting month (1 - 12)

  // 4. Input vs Certified Normalizations
  originalValue: number;          // Raw input quantity
  originalUnit: string;           // Raw input unit indicator (e.g., "Menge: 15.000,00 LTR")
  normalizedValue: number;        // Normalized equivalent quantity based on metric targets
  normalizedUnit: string;         // Metric normalized unit (e.g., "Liters", "kWh", "Metric Tonnes")

  // 5. Environmental Math
  emissionFactor: number;         // Active emission factor coefficient (kg CO2e per normalized unit)
  emissionsKgs: number;           // Total calculated carbon footprint in kilograms (normalizedValue * emissionFactor)
  calculationFormula: string;     // Audit-ready documentation formula (e.g. "9500 kWh * 0.42 kg/kWh")

  // 6. Verification and Audit Ledger
  issues: ValidationIssue[];      // Active validation Warnings, Errors, or Anomalies
  auditTrail: AuditTrailEntry[];  // Chronological manual amendments or actions
  rawRowData: Record<string, any>;// Blob of identical unprocessed source data
}
```

---

## 3. Core Architectural Subsystems

### A. Strict Multi-Tenancy Segregation
* **Tenant Partitioning**: All database lookups and write routes require indexing with `tenantId`. Our layout establishes query isolation boundaries: `SELECT * FROM esg_ledger WHERE tenantId = :clientTenantId`.
* **Credential Isolation**: Secrets, OData endpoints, and API transport hooks of distinct SAP endpoints are loaded dynamically based on validated session contexts, avoiding any cross-tenant configurations.

### B. Unit Normalization Math & Recalculation Engine
Input data streams do not respect Standard units.
* **SAP Fuel Units**: Converts short tons (`ST`) or cubic meters (`M3`) safely into standard *Metric Tonnes* and *Liters* based on material lookup types.
* **Utility Electricity**: Converts regional kWh or therm measurements into standard *kWh*.
* **Business Travel flights**: Real-world PNR records omit passenger distance values. The ingestion engine takes airport coordinates (e.g., `SFO` to `LHR`), computes the spherical distance using the **Haversine formula (Great-Circle path)**:
  $$d = 2 R \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta \phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta \lambda}{2}\right)}\right)$$
  and normalizes flights into passenger-kilometers, applying cabin multipliers (Standard DEFRA standards representing up to 2.9x increase for premium seats to reflect volumetric space footprint on transatlantic lines).

### C. Calendar Appportionment (Anti-Off-Month Distortion)
Electricity billing periods (e.g., April 12 to May 11) cross calendar months. Booking utility figures directly in April or May distorts quarterly reports.
Our model calculates a daily index across the range, splitting the usage dynamically. If 18 days of a 30-day billing cycle sit in April, and 12 days in May, the system allocates:
$$\text{April Usage} = \frac{18}{30} \times \text{Total Usage}$$
This creates **two apportioned rows** in the normalized universal ledger, aligning electricity carbon perfectly with monthly client activity.

### D. Audit Trail
To protect compliance integrity:
* Modifications are stored sequentially in an immutable `auditTrail` array inside each row.
* Each entry logs: `timestamp`, `userId`, `action` (e.g., INGEST, EDIT, RESOLVE, APPROVE) and exact `previousValue` -> `newValue` changes.
* Once a row has been approved, `isLocked` is switched to `true`. From there on, database triggers or application API handlers block all updates or deletions, certifying it for inspection.
