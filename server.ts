import express from 'express';
import { createServer as createViteServer } from 'vite';
import { normalizeIngestedRow } from './src/emissionsMath.ts';
import { NormalizedESGRow, SourceType, ProcessStatus, AuditTrailEntry } from './src/types.ts';
import path from 'path';

const app = express();
app.use(express.json({ limit: '10mb' }));

// -------------------------------------------------------------
// In-Memory Database (Robust State Store with Sample Data)
// -------------------------------------------------------------
let esgRows: NormalizedESGRow[] = [];
const DEFAULT_TENANT = 'Breathe_Enterprise_Tenant_01';

const INITIAL_SAP_ROWS = [
  {
    IDoc_Num: "IDOC-SAP-1011",
    Ref_Po: "PO-2026-9092",
    Material: "MAT-DSL-001",
    Menge: "12.500,00", // German notation: 12500.00
    Einheit: "L",
    Werk: "DE_PL_102",
    Buchungsdatum: "24.04.2026",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    IDoc_Num: "IDOC-SAP-1012",
    Ref_Po: "PO-2026-9093",
    Material: "MAT-COA-X", // ERROR: Unmapped SAP material
    Menge: "450",
    Einheit: "ST",
    Werk: "US_PL_901",
    Buchungsdatum: "05.05.2026",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    IDoc_Num: "IDOC-SAP-1013",
    Ref_Po: "PO-2026-9110",
    Material: "MAT-DSL-001",
    Menge: "85.000,00", // ANOMALY: Extreme stationary fuel usage (>50,000 L)
    Einheit: "L",
    Werk: "DE_PL_102",
    Buchungsdatum: "12.05.2026",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    IDoc_Num: "IDOC-SAP-1014",
    Ref_Po: "PO-2026-9115",
    Material: "MAT-OFFCE-99", // Scope 3 Category 1 - Spend-based
    Menge: "8500",
    Einheit: "EUR",
    Werk: "DE_PL_102",
    Buchungsdatum: "15.05.2026",
    Tenant_Id: DEFAULT_TENANT
  }
];

const INITIAL_UTILITY_ROWS = [
  {
    Account_Number: "UTIL-ELEC-40291",
    Meter_ID: "MET-9910023", // US Texas grid average
    Start_Date: "2026-04-12",
    End_Date: "2026-05-11", // Overlapping calendar month billing cycle
    Previous_Reading: "102900",
    Current_Reading: "121900", // Difference = 19,000 kWh
    Multiplier: "1.0",
    Usage_kWh: "26500", // ANOMALY: Stated 26,500 violates mathematical formula (19,000 kWh)!
    Tariff_Code: "TX_COM_PEAK_B",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    Account_Number: "UTIL-ELEC-77123",
    Meter_ID: "MET-DE-820", // DE RWE grid mix
    Start_Date: "2026-01-01",
    End_Date: "2026-02-25", // WARNING: Period spans 55 days (standard cycle < 45 days)
    Previous_Reading: "50000",
    Current_Reading: "62400", // Difference = 12,400 kWh
    Multiplier: "1.0",
    Usage_kWh: "12400",
    Tariff_Code: "DE_IND_GRID",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    Account_Number: "UTIL-ELEC-88220",
    Meter_ID: "MET-WA-001", // Low emission Hydro-rich grid
    Start_Date: "2026-05-01",
    End_Date: "2026-05-31", // Clean billing alignment
    Previous_Reading: "15000",
    Current_Reading: "24500", // 9500 kWh
    Multiplier: "1.0",
    Usage_kWh: "9500",
    Tariff_Code: "WA_IND_HYDRO",
    Tenant_Id: DEFAULT_TENANT
  }
];

const INITIAL_TRAVEL_ROWS = [
  {
    Booking_Ref: "SFO-LHR-2026",
    Employee_ID: "EMP-092",
    Travel_Type: "Flight",
    Origin_Airport: "SFO",
    Destination_Airport: "LHR", // Medium/Long Haul
    Cabin_Class: "Business", // Business Cabin multiplier (2.9x on long haul)
    Spend_Amount_USD: "4500.00",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    Booking_Ref: "CDG-XYZ-MOCK",
    Employee_ID: "EMP-441",
    Travel_Type: "Flight",
    Origin_Airport: "CDG",
    Destination_Airport: "XYZ", // ERROR: Unrecognized airport. Substituted spend factor fallback.
    Cabin_Class: "Economy",
    Spend_Amount_USD: "850.00",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    Booking_Ref: "DXB-HOTEL-99",
    Employee_ID: "EMP-092",
    Travel_Type: "Hotel",
    Hotel_Nights: "5",
    Hotel_Country: "AE", // High emissions nights
    Spend_Amount_USD: "1200.00",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    Booking_Ref: "FR-HOTEL-21",
    Employee_ID: "EMP-103",
    Travel_Type: "Hotel",
    Hotel_Nights: "5",
    Hotel_Country: "FR", // Clean grid nights
    Spend_Amount_USD: "650.00",
    Tenant_Id: DEFAULT_TENANT
  },
  {
    Booking_Ref: "TAX-GROUND-04",
    Employee_ID: "EMP-103",
    Travel_Type: "Ground",
    Ground_Type: "Car_Gasoline",
    Spend_Amount_USD: "120.00",
    Tenant_Id: DEFAULT_TENANT
  }
];

function initializeMockDatabase() {
  esgRows = [];
  
  // Ingest SAP
  INITIAL_SAP_ROWS.forEach((r, idx) => {
    const rawNormalized = normalizeIngestedRow('SAP', r, DEFAULT_TENANT, idx);
    rawNormalized.forEach((row, subIdx) => {
      row.auditTrail.push({
        id: `aud_${Date.now()}_sap_${idx}_${subIdx}`,
        timestamp: new Date().toISOString(),
        userId: 'system_pipe',
        userName: 'SAP Automated IDoc Daemon',
        action: 'INGEST',
        notes: `Row created automatically from SAP IDoc format. Material code ${r.Material} matching.`,
      });
      esgRows.push(row);
    });
  });

  // Ingest Utility
  INITIAL_UTILITY_ROWS.forEach((r, idx) => {
    const rawNormalized = normalizeIngestedRow('UTILITY', r, DEFAULT_TENANT, idx);
    rawNormalized.forEach((row, subIdx) => {
      row.auditTrail.push({
        id: `aud_${Date.now()}_util_${idx}_${subIdx}`,
        timestamp: new Date().toISOString(),
        userId: 'system_pipe',
        userName: 'Utility Portal Scraping Hook',
        action: 'INGEST',
        notes: `Utility profile ingested. Found billing range ${r.Start_Date} to ${r.End_Date}. Calculated monthly distribution: ${row.normalizedValue} ${row.normalizedUnit} apportioned to calendar month ${row.reportingMonth}.`,
      });
      esgRows.push(row);
    });
  });

  // Ingest Travel
  INITIAL_TRAVEL_ROWS.forEach((r, idx) => {
    const rawNormalized = normalizeIngestedRow('TRAVEL', r, DEFAULT_TENANT, idx);
    rawNormalized.forEach((row, subIdx) => {
      row.auditTrail.push({
        id: `aud_${Date.now()}_travel_${idx}_${subIdx}`,
        timestamp: new Date().toISOString(),
        userId: 'system_pipe',
        userName: 'Concur GDS API Connector',
        action: 'INGEST',
        notes: `Corporate travels fetched. Core category resolved to '${r.Travel_Type}'.`,
      });
      esgRows.push(row);
    });
  });
}

// Perform initial boot database loading
initializeMockDatabase();

// -------------------------------------------------------------
// REST API Endpoints
// -------------------------------------------------------------

// GET /api/rows - List matching ledger records
app.get('/api/rows', (req, res) => {
  const { tenantId, sourceType, status, scope } = req.query;
  let responseList = [...esgRows];

  // Apply tenant level safety boundaries (Multi-tenancy isolation logic)
  if (tenantId) {
    responseList = responseList.filter(r => r.tenantId === tenantId);
  }

  if (sourceType) {
    responseList = responseList.filter(r => r.sourceType === sourceType);
  }

  if (status) {
    responseList = responseList.filter(r => r.status === status);
  }

  if (scope) {
    responseList = responseList.filter(r => r.scope === scope);
  }

  res.json({ success: true, count: responseList.length, data: responseList });
});

// POST /api/rows/ingest - Manually ingest a set of raw templates
app.post('/api/rows/ingest', (req, res) => {
  const { sourceType, rawData, tenantId = DEFAULT_TENANT } = req.body;

  if (!sourceType || !rawData || !Array.isArray(rawData)) {
    return res.status(400).json({ success: false, error: 'Mandatory parameters: sourceType (SAP/UTILITY/TRAVEL) and rawData array' });
  }

  const added: NormalizedESGRow[] = [];
  rawData.forEach((item, index) => {
    const outputs = normalizeIngestedRow(sourceType as SourceType, item, tenantId, index + esgRows.length);
    outputs.forEach((row, subIdx) => {
      row.auditTrail.push({
        id: `aud_manual_${Date.now()}_${index}_${subIdx}`,
        timestamp: new Date().toISOString(),
        userId: 'analyst_01',
        userName: 'Lead ESG Auditor',
        action: 'INGEST',
        notes: `Surgical upload of raw record from source ${sourceType}.`
      });
      esgRows.push(row);
      added.push(row);
    });
  });

  res.json({ success: true, count: added.length, data: added });
});

// GET /api/rows/:id - Fetch single row audit profile
app.get('/api/rows/:id', (req, res) => {
  const row = esgRows.find(r => r.id === req.params.id);
  if (!row) {
    return res.status(404).json({ success: false, error: `Auditing row ${req.params.id} could not be resolved.` });
  }
  res.json({ success: true, data: row });
});

// PUT /api/rows/:id - Edit a row's core variables and trigger real-time re-normalization recalculations
app.put('/api/rows/:id', (req, res) => {
  const { originalValue, originalUnit, facilityId, country, materialMappingValue } = req.body;
  const rowIndex = esgRows.findIndex(r => r.id === req.params.id);

  if (rowIndex === -1) {
    return res.status(404).json({ success: false, error: `Row ${req.params.id} does not exist.` });
  }

  const row = esgRows[rowIndex];
  if (row.isLocked) {
    return res.status(403).json({ success: false, error: 'This ledger record has been locked and certified for auditors and is not editable.' });
  }

  // Preserve history
  const previousValueStr = JSON.stringify({
    originalValue: row.originalValue,
    originalUnit: row.originalUnit,
    facilityId: row.facilityId,
    country: row.country,
  });

  // Material override (to fix material mapping errors)
  if (row.sourceType === 'SAP' && materialMappingValue) {
    row.rawRowData.Material = materialMappingValue;
  }

  // If modifying original quantity characteristics, perform complete re-normalization!
  const updatedValue = typeof originalValue === 'number' ? originalValue : parseFloat(originalValue) || 0;
  row.rawRowData.Menge = updatedValue.toString();
  if (originalUnit) {
    row.rawRowData.Einheit = originalUnit;
  }
  if (facilityId) {
    row.rawRowData.Meter_ID = facilityId; // Utility mapping
    row.rawRowData.Werk = facilityId;     // SAP Plant mapping
  }

  // Call engine re-normalization to trigger instant recalculated emissions math & re-validate!
  const outputs = normalizeIngestedRow(row.sourceType, row.rawRowData, row.tenantId, rowIndex);
  if (outputs.length > 0) {
    const updatedModel = outputs[0];
    
    // Copy computed mathematics onto the existing record to maintain reference identity and pending statuses
    row.scope = updatedModel.scope;
    row.category = updatedModel.category;
    row.facilityId = facilityId || updatedModel.facilityId;
    row.country = country || updatedModel.country;
    row.originalValue = updatedModel.originalValue;
    row.originalUnit = updatedModel.originalUnit;
    row.normalizedValue = updatedModel.normalizedValue;
    row.normalizedUnit = updatedModel.normalizedUnit;
    row.emissionFactor = updatedModel.emissionFactor;
    row.emissionsKgs = updatedModel.emissionsKgs;
    row.calculationFormula = updatedModel.calculationFormula;
    row.issues = updatedModel.issues; // Fresh issues based on updated constraints
  }

  row.auditTrail.push({
    id: `aud_edit_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: 'analyst_01',
    userName: 'Lead ESG Auditor',
    action: 'EDIT',
    notes: `Manual adjustment of activity measurements by analyst. Triggered automated re-normalizer & Recalculated Scope factor emissions to ${row.emissionsKgs} kg CO2e.`,
    previousValue: previousValueStr,
    newValue: JSON.stringify({
      originalValue: row.originalValue,
      originalUnit: row.originalUnit,
      facilityId: row.facilityId,
      country: row.country,
    })
  });

  res.json({ success: true, data: row });
});

// POST /api/rows/:id/resolve-issue - Flag a specific error or anomaly as resolved
app.post('/api/rows/:id/resolve-issue', (req, res) => {
  const { issueIndex, analystNotes } = req.body;
  const row = esgRows.find(r => r.id === req.params.id);

  if (!row) {
    return res.status(404).json({ success: false, error: 'Ledger row unresolved.' });
  }

  if (row.isLocked) {
    return res.status(403).json({ success: false, error: 'Cannot amend locked records.' });
  }

  const targetIssue = row.issues[issueIndex];
  if (!targetIssue) {
    return res.status(400).json({ success: false, error: 'Target audit warning issue not found.' });
  }

  targetIssue.resolved = true;
  targetIssue.resolvedBy = 'Lead ESG Auditor (analyst_01)';
  targetIssue.resolvedAt = new Date().toISOString();

  row.auditTrail.push({
    id: `aud_resolve_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: 'analyst_01',
    userName: 'Lead ESG Auditor',
    action: 'FLAG_RESOLVE',
    notes: `Resolved validation flag on index '${issueIndex}' [${targetIssue.type}]. Analysts comments: "${analystNotes}"`
  });

  res.json({ success: true, data: row });
});

// POST /api/rows/:id/approve - Approve row and lock it forever
app.post('/api/rows/:id/approve', (req, res) => {
  const row = esgRows.find(r => r.id === req.params.id);
  if (!row) {
    return res.status(404).json({ success: false, error: 'Row not found.' });
  }

  if (row.status === 'APPROVED') {
    return res.status(400).json({ success: false, error: 'Row is already approved.' });
  }

  // Warning check: let analysts sign off despite warning/anomalies IF they have added explanatory notes
  const activeUnresolvedIssues = row.issues.filter(i => !i.resolved);
  const criticalErrors = activeUnresolvedIssues.filter(i => i.type === 'ERROR');

  if (criticalErrors.length > 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Audit compliance violation: You cannot sign-off on a record with active high-severity ERROR validation states. Fix the core activity record mapping first!'
    });
  }

  row.status = 'APPROVED';
  row.isLocked = true; // Certified and locked for auditor reads
  row.analystApprovedBy = 'Lead ESG Auditor (analyst_01)';
  row.analystApprovedAt = new Date().toISOString();

  row.auditTrail.push({
    id: `aud_approve_${Date.now()}`,
    timestamp: new Date().toISOString(),
    userId: 'analyst_01',
    userName: 'Lead ESG Auditor',
    action: 'APPROVE',
    notes: 'Record officially certified, marked static and locked ready for auditing.'
  });

  res.json({ success: true, data: row });
});

// POST /api/rows/reset - Reset Database to clean state
app.post('/api/rows/reset', (req, res) => {
  initializeMockDatabase();
  res.json({ success: true, message: 'Audited ledger reset successfully to baseline raw SAP, Utility, and corporate travel ingest streams!' });
});

// -------------------------------------------------------------
// Dev & Production Serving Modes
// -------------------------------------------------------------
const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';

async function startServer() {
  if (!isProd) {
    console.log('--- RUNNING DEVELOPER BOOTSTRAP ENVIRONMENT ---');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    
    app.use(vite.middlewares);
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Vite Dev server proxy running on http://0.0.0.0:${PORT} ready for preview loads.`);
    });
  } else {
    console.log('--- STARTING SYSTEM PRODUCTION RUNTIME ---');
    // Serve static frontend build assets
    app.use(express.static(path.join(process.cwd(), 'dist')));
    
    // Fallback any routing to SPA React client
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
    });

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Breathe ESG service running on external port ${PORT}`);
    });
  }
}

startServer().catch((err) => {
  console.error('Breathe ESG critical server boot panic:', err);
});
