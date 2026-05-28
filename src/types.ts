/**
 * Breathe ESG Types Definition
 * This file maintains the target schemas, raw ingest schema representations,
 * audit trails, validation issues, multi-tenancy, and ESG reporting structure.
 */

export type ScopeType = 'Scope 1' | 'Scope 2' | 'Scope 3';

export type SourceType = 'SAP' | 'UTILITY' | 'TRAVEL';

export type ProcessStatus = 'PENDING' | 'REJECTED' | 'APPROVED';

export interface AuditTrailEntry {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  action: string; // e.g., 'INGEST', 'EDIT', 'FLAG_RESOLVE', 'APPROVE', 'REJECT'
  notes: string;
  previousValue?: string;
  newValue?: string;
}

export interface ValidationIssue {
  type: 'ERROR' | 'WARNING' | 'ANOMALY';
  field: string;
  message: string;
  severity: 'high' | 'medium' | 'low';
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

// Global target schema for analyst review and sign-off
export interface NormalizedESGRow {
  id: string; // Internal unique tracking ID
  tenantId: string; // Enterprise tenant/client identification (multi-tenancy)
  sourceType: SourceType; // SAP | UTILITY | TRAVEL
  sourceRowId: string; // IDoc Num, Account_Num, or Booking_Ref as the direct source pointer
  
  // Categorization
  scope: ScopeType;
  category: string; // e.g., "Scope 1 - Direct Stationary Combustion", "Scope 2 - Purchased Electricity", "Scope 3 - Category 6 (Business Travel)"
  facilityId: string; // e.g., Plant DE_PL_102, Meter MET-9910023, or Region West
  country: string; // Normalized country (e.g., DE, US, UK)
  
  // Temporal Alignments
  originalDate: string; // Original posting or start date
  billingPeriodStart?: string; // For utility/electricity
  billingPeriodEnd?: string; // For utility/electricity
  reportingYear: number; // e.g., 2026
  reportingMonth: number; // Normalized calendar month (1 - 12) after apportioning
  
  // Quantities & Calculations
  originalValue: number;
  originalUnit: string;
  normalizedValue: number; // Normalized to metric units (e.g. Liters, kWh, kg)
  normalizedUnit: string;
  
  // Emissions Math
  emissionFactor: number; // kg CO2e per normalized unit
  emissionsKgs: number; // Total calculated emissions in kg CO2e
  calculationFormula: string; // Clear auditing equation string
  
  // Status & Governance
  status: ProcessStatus;
  analystApprovedBy?: string;
  analystApprovedAt?: string;
  isLocked: boolean; // Once approved, row is frozen for auditor read-only locks
  
  // Audit & Validation
  issues: ValidationIssue[];
  auditTrail: AuditTrailEntry[];
  rawRowData: Record<string, any>; // Stores exact historical fields before mapping
}

// 1. Raw SAP Row Ingestion Format
export interface RawSAPRow {
  IDoc_Num: string;       // e.g. "0000000010928374"
  Ref_Po: string;         // Purchase Order "PO-45001009"
  Material: string;       // Material Identifier "MAT-DSL-001" (Diesel) or "MAT-COA-002"
  Menge: string;          // Numeric quantity, can pack commas or decimal mismatches "15.000,00" or "400"
  Einheit: string;        // SAP unit code, e.g., "GAL", "ST", "L", "TO"
  Werk: string;           // Plant "DE_PL_102" or "US_PL_901"
  Buchungsdatum: string;  // SAP German styled date "28.05.2026"
  Tenant_Id: string;      // Multi-tenant key
}

// 2. Raw Utility Electricity Row Ingestion Format
export interface RawUtilityRow {
  Account_Number: string; // Customer identifier
  Meter_ID: string;       // Specific physical meter ID
  Start_Date: string;     // Billing period start "2026-04-12"
  End_Date: string;       // Billing period end "2026-05-11"
  Previous_Reading: string;
  Current_Reading: string;
  Multiplier: string;     // Meter constant multiplier
  Usage_kWh: string;      // Can be calculated or directly stated
  Tariff_Code: string;    // Tariff details (peak rates indicate suspicious shifts)
  Tenant_Id: string;
}

// 3. Raw Travel Row Ingestion Format
export interface RawTravelRow {
  Booking_Ref: string;    // PNR code e.g. "PNR-AB9C3D"
  Employee_ID: string;    // Corporate ID
  Travel_Type: string;    // "Flight", "Hotel", "Ground"
  Origin_Airport?: string; // e.g. "SFO"
  Destination_Airport?: string; // e.g. "JFK"
  Cabin_Class?: string;  // "Economy", "Business", "First"
  Hotel_Nights?: string;  // Length of stay
  Hotel_Country?: string; // e.g., "DE", "US", "GB"
  Ground_Type?: string;   // "Taxi", "Train", "Rental_Gas"
  Spend_Amount_USD: string;
  Tenant_Id: string;
}

// Summary interface for reporting statistics
export interface AnalyticsData {
  totalEmissionsKgs: number;
  emissionsByScope: Record<ScopeType, number>;
  emissionsBySource: Record<SourceType, number>;
  monthlyEmissions: { month: string; emissions: number }[];
  ingestedCount: number;
  pendingCount: number;
  failedCount: number;
  approvedCount: number;
  lockedCount: number;
}
