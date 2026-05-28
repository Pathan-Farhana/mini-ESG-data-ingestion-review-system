import { useState, useEffect } from 'react';
import { 
  CheckCircle, 
  AlertTriangle, 
  XCircle, 
  Edit2, 
  RefreshCw, 
  FileText, 
  Database, 
  Upload, 
  Download, 
  Lock, 
  User, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  MapPin, 
  Activity, 
  Calendar, 
  Plane, 
  Hotel, 
  Car, 
  Sliders,
  Sparkles
} from 'lucide-react';
import { NormalizedESGRow, SourceType, ProcessStatus, ScopeType } from './types.ts';

// Ready-to-ingest realistic real-world template snippets for quick-testing the pipeline
const RAW_TEMPLATES = {
  SAP: [
    {
      label: "Standard Diesel Shipment",
      data: {
        IDoc_Num: "IDOC-SAP-5012",
        Ref_Po: "PO-2026-0044",
        Material: "MAT-DSL-001",
        Menge: "4.800,00",
        Einheit: "L",
        Werk: "DE_PL_102",
        Buchungsdatum: "28.05.2026"
      }
    },
    {
      label: "Unknown Raw Material SKU (Throws Error)",
      data: {
        IDoc_Num: "IDOC-SAP-5013",
        Ref_Po: "PO-2026-0045",
        Material: "MAT-UNKNOWN-SKU99",
        Menge: "300",
        Einheit: "TO",
        Werk: "US_PL_901",
        Buchungsdatum: "25.04.2026"
      }
    },
    {
      label: "Excessive Fuel Volumetrics (Throws Anomaly)",
      data: {
        IDoc_Num: "IDOC-SAP-5014",
        Ref_Po: "PO-2026-0046",
        Material: "MAT-DSL-001",
        Menge: "95.000,00",
        Einheit: "L",
        Werk: "DE_PL_102",
        Buchungsdatum: "18.05.2026"
      }
    }
  ],
  UTILITY: [
    {
      label: "Oregon Hydro Electric Bill",
      data: {
        Account_Number: "UTIL-PACIFIC-889",
        Meter_ID: "MET-WA-001",
        Start_Date: "2026-05-01",
        End_Date: "2026-05-31",
        Previous_Reading: "44200",
        Current_Reading: "51250",
        Multiplier: "1.0",
        Usage_kWh: "7050",
        Tariff_Code: "PACIFIC_GREEN_A"
      }
    },
    {
      label: "Imbalanced Readings Delta Mismatch (Throws Anomaly)",
      data: {
        Account_Number: "UTIL-ERCOT-9012",
        Meter_ID: "MET-9910023",
        Start_Date: "2026-05-01",
        End_Date: "2026-05-31",
        Previous_Reading: "85200",
        Current_Reading: "92100", // Delta computed: 6,900 kWh
        Multiplier: "1.0",
        Usage_kWh: "14800", // Stated: 14,800 kWh (Violates mathematical validation!)
        Tariff_Code: "TX_COM_PEAK_C"
      }
    }
  ],
  TRAVEL: [
    {
      label: "Long Haul Business Flight (SFO to Dubai)",
      data: {
        Booking_Ref: "DXB-CONC-2026",
        Employee_ID: "EMP-085",
        Travel_Type: "Flight",
        Origin_Airport: "SFO",
        Destination_Airport: "DXB",
        Cabin_Class: "Business",
        Spend_Amount_USD: "6800.00"
      }
    },
    {
      label: "Unknown Airport Route Fallback (Throws Warning)",
      data: {
        Booking_Ref: "LHR-XYZ-CONC",
        Employee_ID: "EMP-102",
        Travel_Type: "Flight",
        Origin_Airport: "LHR",
        Destination_Airport: "XYZ", // Unsupported airport code
        Cabin_Class: "Economy",
        Spend_Amount_USD: "650.00"
      }
    },
    {
      label: "UAE Executive Hotel Stay",
      data: {
        Booking_Ref: "DXB-HOTEL-20",
        Employee_ID: "EMP-085",
        Travel_Type: "Hotel",
        Hotel_Nights: "6",
        Hotel_Country: "AE",
        Spend_Amount_USD: "2100.00"
      }
    }
  ]
};

export default function App() {
  const [esgRows, setEsgRows] = useState<NormalizedESGRow[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filtering states
  const [tenantFilter, setTenantFilter] = useState('Breathe_Enterprise_Tenant_01');
  const [sourceFilter, setSourceFilter] = useState<string>('ALL');
  const [scopeFilter, setScopeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  
  // UI UX States
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedPresetSource, setSelectedPresetSource] = useState<SourceType>('SAP');
  const [manualJsonText, setManualJsonText] = useState(JSON.stringify(RAW_TEMPLATES.SAP[0].data, null, 2));
  
  // Inline editing states (scoped to active expanding row)
  const [editQty, setEditQty] = useState<string>('');
  const [editUnit, setEditUnit] = useState<string>('');
  const [editFacility, setEditFacility] = useState<string>('');
  const [editCountry, setEditCountry] = useState<string>('');
  const [overrideMaterialCode, setOverrideMaterialCode] = useState<string>('');
  const [editMode, setEditMode] = useState(false);

  // Resolution Notes States
  const [activeIssueIndex, setActiveIssueIndex] = useState<number | null>(null);
  const [resolutionNote, setResolutionNote] = useState<string>('');

  const [notification, setNotification] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Load backend rows
  const fetchRows = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/rows?tenantId=${tenantFilter}`);
      const data = await res.json();
      if (data.success) {
        setEsgRows(data.data);
      }
    } catch (err) {
      triggerNotification('error', 'Failed to fetch the ESG universal ledger.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRows();
  }, [tenantFilter]);

  const triggerNotification = (type: 'success' | 'error', text: string) => {
    setNotification({ type, text });
    setTimeout(() => setNotification(null), 5000);
  };

  // Switch preset formats for rapid ingestion demo
  const selectRawPreset = (jsonObj: Record<string, any>) => {
    setManualJsonText(JSON.stringify(jsonObj, null, 2));
  };

  // Perform bulk manual ingestion
  const handleIngest = async () => {
    try {
      let parsed;
      try {
        parsed = JSON.parse(manualJsonText);
      } catch (e) {
        triggerNotification('error', 'Malformed payload. Ingest stream requires valid JSON.');
        return;
      }

      const payload = Array.isArray(parsed) ? parsed : [parsed];
      const res = await fetch('/api/rows/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceType: selectedPresetSource,
          rawData: payload,
          tenantId: tenantFilter
        })
      });

      const responseData = await res.json();
      if (responseData.success) {
        triggerNotification('success', `Direct ingestion completed: ${responseData.count} record(s) normalized.`);
        fetchRows();
      } else {
        triggerNotification('error', responseData.error || 'Ingestion failed.');
      }
    } catch (e) {
      triggerNotification('error', 'Critical operational block during network ingest POST.');
    }
  };

  // Soft Reset state
  const handleReset = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/rows/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        triggerNotification('success', 'In-memory ledgers reset to baseline raw templates successfully!');
        fetchRows();
        setExpandedId(null);
        setEditMode(false);
      }
    } catch (err) {
      triggerNotification('error', 'Database resetting failed.');
    }
  };

  // Trigger inline save edit
  const saveInlineEdit = async (id: string) => {
    try {
      const payload: Record<string, any> = {
        originalValue: parseFloat(editQty) || 0,
        originalUnit: editUnit,
        facilityId: editFacility,
        country: editCountry,
      };

      if (overrideMaterialCode) {
        payload.materialMappingValue = overrideMaterialCode;
      }

      const res = await fetch(`/api/rows/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      
      if (data.success) {
        triggerNotification('success', 'Recalculation engine completed. Normalized emissions updated.');
        setEditMode(false);
        // Sync row details instantly
        setEsgRows(prev => prev.map(r => r.id === id ? data.data : r));
      } else {
        triggerNotification('error', data.error || 'Recalculation aborted.');
      }
    } catch (err) {
      triggerNotification('error', 'Edit network pipeline failed.');
    }
  };

  // Issue resolve action
  const resolveTargetIssue = async (rowId: string, index: number) => {
    if (!resolutionNote.trim()) {
      triggerNotification('error', 'Compliance requires explaining the resolution path. Note is empty.');
      return;
    }
    try {
      const res = await fetch(`/api/rows/${rowId}/resolve-issue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ issueIndex: index, analystNotes: resolutionNote })
      });
      const data = await res.json();
      if (data.success) {
        triggerNotification('success', 'Audit anomaly flag flagged compiled & resolved!');
        setEsgRows(prev => prev.map(r => r.id === rowId ? data.data : r));
        setActiveIssueIndex(null);
        setResolutionNote('');
      } else {
        triggerNotification('error', data.error || 'Adjustment blocked.');
      }
    } catch (err) {
      triggerNotification('error', 'Issue adjustment error.');
    }
  };

  // Analyst signoff / freeze row
  const approveAndLockRow = async (id: string) => {
    try {
      const res = await fetch(`/api/rows/${id}/approve`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        triggerNotification('success', 'Row officially certified! Record locked for financial audits.');
        setEsgRows(prev => prev.map(r => r.id === id ? data.data : r));
      } else {
        triggerNotification('error', data.error || 'Audit lock block.');
      }
    } catch (err) {
      triggerNotification('error', 'Locking action failed.');
    }
  };

  // Export clean certified ledger
  const exportLedger = () => {
    const output = JSON.stringify(esgRows.filter(r => r.status === 'APPROVED'), null, 2);
    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Certified_ESG_Ledger_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    triggerNotification('success', 'Certified emissions audit ledger compiled and downloaded.');
  };

  // Calculate high value analytics metrics
  const approvedCount = esgRows.filter(r => r.status === 'APPROVED').length;
  const pendingCount = esgRows.filter(r => r.status === 'PENDING').length;
  const totalScope1 = esgRows.reduce((acc, r) => r.scope === 'Scope 1' ? acc + r.emissionsKgs : acc, 0);
  const totalScope2 = esgRows.reduce((acc, r) => r.scope === 'Scope 2' ? acc + r.emissionsKgs : acc, 0);
  const totalScope3 = esgRows.reduce((acc, r) => r.scope === 'Scope 3' ? acc + r.emissionsKgs : acc, 0);
  const totalEmissionsKg = totalScope1 + totalScope2 + totalScope3;

  // Track unresolved errors & warnings
  const unresolvedIssuesCount = esgRows.reduce((acc, r) => {
    const unresolved = r.issues.filter(i => !i.resolved).length;
    return acc + unresolved;
  }, 0);

  // Set initial editing properties when expanding rows
  const setupEditForm = (row: NormalizedESGRow) => {
    setEditQty(row.originalValue.toString());
    setEditUnit(row.originalUnit);
    setEditFacility(row.facilityId);
    setEditCountry(row.country);
    setOverrideMaterialCode(row.sourceType === 'SAP' ? row.rawRowData.Material || '' : '');
    setEditMode(false);
    setActiveIssueIndex(null);
  };

  // Computed display lists based on UI filters
  const filteredRows = esgRows.filter(r => {
    if (sourceFilter !== 'ALL' && r.sourceType !== sourceFilter) return false;
    if (scopeFilter !== 'ALL' && r.scope !== scopeFilter) return false;
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    return true;
  });

  return (
    <div id="breathe-esg-app" className="min-h-screen bg-slate-900 text-slate-100 font-sans antialiased pb-20 selection:bg-teal-500 selection:text-slate-950">
      
      {/* Dynamic Flash Notifications Banner */}
      {notification && (
        <div 
          id="system-notification"
          className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-lg shadow-2xl border transition-all duration-300 transform translate-y-0 ${
            notification.type === 'success' 
              ? 'bg-teal-950/90 border-teal-500/50 text-teal-300' 
              : 'bg-rose-950/90 border-rose-500/50 text-rose-300'
          }`}
        >
          {notification.type === 'success' ? <CheckCircle className="w-5 h-5 text-teal-400" /> : <XCircle className="w-5 h-5 text-rose-400" />}
          <p className="text-sm font-medium tracking-wide">{notification.text}</p>
        </div>
      )}

      {/* Modern, High Contrast Header */}
      <header id="app-header" className="border-b border-slate-800 bg-slate-950/70 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-18 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/20">
              <Sparkles className="w-5 h-5 text-slate-950" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight text-white m-0 flex items-center gap-2">
                Breathe ESG 
                <span className="text-[10px] uppercase tracking-widest bg-slate-800 text-slate-300 px-2 py-0.5 rounded-full border border-slate-700">
                  Prototype Console
                </span>
              </h1>
              <p className="text-xs text-slate-400 m-0">Corporate Ingestion, Normalization, & Audit Certification Ledger</p>
            </div>
          </div>

          {/* Tenant Selector & Global Actions */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 px-3 py-1.5 rounded-lg">
              <User className="w-4 h-4 text-slate-400" />
              <select 
                id="tenant-filter"
                value={tenantFilter} 
                onChange={(e) => setTenantFilter(e.target.value)} 
                className="bg-transparent border-none text-xs font-semibold text-slate-300 focus:outline-none cursor-pointer"
              >
                <option value="Breathe_Enterprise_Tenant_01" className="bg-slate-950">Enterprise Tenant #1</option>
                <option value="Breathe_Enterprise_Tenant_02" className="bg-slate-950">Enterprise Tenant #2 (Auxiliary)</option>
              </select>
            </div>
            
            <button 
              id="reset-state-button"
              onClick={handleReset}
              className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-3.5 py-2 rounded-lg transition-all"
              title="Restores dirty data profiles with realistic SAP parser issues & mapping gaps."
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reset Workspace
            </button>

            <button
              id="download-ledger-button"
              onClick={exportLedger}
              disabled={approvedCount === 0}
              className={`flex items-center gap-2 text-xs font-medium px-3.5 py-2 rounded-lg border transition-all ${
                approvedCount > 0 
                  ? 'bg-teal-500 hover:bg-teal-400 text-slate-950 border-teal-500 justify-center font-bold cursor-pointer' 
                  : 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              Export Certified Ledger ({approvedCount})
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 pt-8 grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* LEFT 2 COLUMNS: LEDGER FILTER & DATA GRID */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* INTUATIVE STATS SCORE-BOARD */}
          <div id="stats-dashboard" className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 h-12 w-12 bg-teal-500/5 blur-xl rounded-full" />
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Total Carbon Mix</p>
              <p className="text-2xl font-extrabold text-white mt-1">
                {(totalEmissionsKg / 1000).toFixed(2)} <span className="text-xs font-medium text-slate-400">t CO2e</span>
              </p>
              <div className="mt-2 text-[10px] text-slate-400 flex items-center justify-between">
                <span>Scope 1: {((totalScope1 / (totalEmissionsKg || 1)) * 100).toFixed(0)}%</span>
                <span>Scope 2: {((totalScope2 / (totalEmissionsKg || 1)) * 100).toFixed(0)}%</span>
                <span>Scope 3: {((totalScope3 / (totalEmissionsKg || 1)) * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl shadow-lg">
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Active Audit Flags</p>
              <p className="text-2xl font-extrabold text-amber-400 mt-1 flex items-baseline gap-2">
                {unresolvedIssuesCount}
                <span className="text-xs font-normal text-slate-400">active alerts</span>
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-[10px]">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                <span className="text-slate-400 font-medium">Demands operational sign-off</span>
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl shadow-lg">
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Sign-Off Progress</p>
              <p className="text-2xl font-extrabold text-white mt-1 flex items-baseline gap-2">
                {approvedCount} / <span className="text-sm font-medium text-slate-400">{esgRows.length}</span>
              </p>
              <div className="mt-2 w-full bg-slate-800 h-1.5 rounded-full overflow-hidden">
                <div 
                  className="bg-teal-500 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${(approvedCount / (esgRows.length || 1)) * 100}%` }}
                />
              </div>
            </div>

            <div className="bg-slate-950 border border-slate-800 p-4 rounded-xl shadow-lg">
              <p className="text-[10px] uppercase font-bold tracking-widest text-slate-400">Pending Columns</p>
              <p className="text-2xl font-extrabold text-teal-400 mt-1">
                {pendingCount}
                <span className="text-xs font-normal text-slate-400 ml-2">to review</span>
              </p>
              <p className="mt-2 text-[10px] text-slate-400 flex items-center gap-1">
                <Lock className="w-3 h-3 text-teal-500" /> Locked ready for auditors
              </p>
            </div>
          </div>

          {/* LEDGER FILTER CONTROLS */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-bold uppercase tracking-wider text-slate-405">Ledger Controls:</span>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* SOURCE FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-slate-500 font-bold">Source Stream</label>
                <select 
                  id="source-filter"
                  value={sourceFilter} 
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg text-xs px-2.5 py-1 text-slate-300 focus:ring-1 focus:ring-teal-500 focus:outline-none"
                >
                  <option value="ALL">All Channels</option>
                  <option value="SAP">SAP (Fuel & Proc.)</option>
                  <option value="UTILITY">Utility (Electricity)</option>
                  <option value="TRAVEL">Corporate Travel (PNRs)</option>
                </select>
              </div>

              {/* SCOPE FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-slate-500 font-bold">Scope</label>
                <select 
                  id="scope-filter"
                  value={scopeFilter} 
                  onChange={(e) => setScopeFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg text-xs px-2.5 py-1 text-slate-300 focus:ring-1 focus:ring-teal-500 focus:outline-none"
                >
                  <option value="ALL">All Scopes</option>
                  <option value="Scope 1">Scope 1 (Stationary/Mobile)</option>
                  <option value="Scope 2">Scope 2 (Electricity)</option>
                  <option value="Scope 3">Scope 3 (Business Travel/Goods)</option>
                </select>
              </div>

              {/* ACTION/STATUS FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase text-slate-500 font-bold">Verification State</label>
                <select 
                  id="status-filter"
                  value={statusFilter} 
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="bg-slate-900 border border-slate-800 rounded-lg text-xs px-2.5 py-1 text-slate-300 focus:ring-1 focus:ring-teal-500 focus:outline-none"
                >
                  <option value="ALL">All States</option>
                  <option value="PENDING">Pending Action</option>
                  <option value="APPROVED">Certified & Locked</option>
                </select>
              </div>
            </div>
          </div>

          {/* DYNAMIC ESG LEDGER WATERFALL LIST */}
          <div id="ledger-list" className="space-y-4">
            {loading ? (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-teal-400 animate-spin" />
                <p className="text-sm font-medium">Re-normalizing and apportioning dynamic records...</p>
              </div>
            ) : filteredRows.length === 0 ? (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
                <Database className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <h3 className="text-white font-bold mb-1">No Matching Activity Records</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">Try adjusting the filter configurations or click &ldquo;Reset Workspace&rdquo; to preload realistic entries.</p>
              </div>
            ) : (
              filteredRows.map((row) => {
                const isExpanded = expandedId === row.id;
                const hasUnresolvedIssues = row.issues.some(i => !i.resolved);
                const hasCriticalError = row.issues.some(i => i.type === 'ERROR' && !i.resolved);
                
                return (
                  <div 
                    key={row.id} 
                    id={`row-${row.id}`}
                    className={`bg-slate-950 rounded-xl border transition-all duration-300 overflow-hidden ${
                      isExpanded ? 'border-teal-500/60 ring-1 ring-teal-500/20 shadow-xl' : 
                      hasCriticalError ? 'border-rose-900/65 hover:border-rose-800' :
                      hasUnresolvedIssues ? 'border-amber-900/65 hover:border-amber-800' : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    
                    {/* PRIMARY COLLAPSIBLE HEAD-LINE PANEL */}
                    <div 
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedId(null);
                        } else {
                          setExpandedId(row.id);
                          setupEditForm(row);
                        }
                      }}
                      className="p-5 flex flex-wrap items-center justify-between gap-4 cursor-pointer hover:bg-slate-900/40 select-none"
                    >
                      
                      {/* Left Block: Source Badge, Dates, Scopes */}
                      <div className="flex items-center gap-4">
                        <div className={`p-2.5 rounded-lg border ${
                          row.sourceType === 'SAP' ? 'bg-indigo-950/40 border-indigo-500/35 text-indigo-400' :
                          row.sourceType === 'UTILITY' ? 'bg-amber-950/40 border-amber-500/35 text-amber-400' :
                          'bg-teal-900/40 border-teal-500/35 text-teal-400'
                        }`}>
                          {row.sourceType === 'SAP' && <Database className="w-5 h-5" />}
                          {row.sourceType === 'UTILITY' && <Activity className="w-5 h-5" />}
                          {row.sourceType === 'TRAVEL' && (
                            row.category.includes('Flights') ? <Plane className="w-5 h-5" /> :
                            row.category.includes('Hotels') ? <Hotel className="w-5 h-5" /> : <Car className="w-5 h-5" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-800 text-slate-300 px-2 py-0.5 rounded border border-slate-700">
                              {row.sourceType === 'SAP' ? `SAP • ${row.sourceRowId}` : 
                               row.sourceType === 'UTILITY' ? `Meter • ${row.facilityId}` : 
                               `Booking • ${row.sourceRowId}`}
                            </span>
                            
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              row.scope === 'Scope 1' ? 'bg-red-950/40 text-red-400 border border-red-900/40' :
                              row.scope === 'Scope 2' ? 'bg-blue-950/40 text-blue-400 border border-blue-900/40' :
                              'bg-indigo-950/40 text-indigo-400 border border-indigo-900/40'
                            }`}>
                              {row.scope}
                            </span>
                          </div>

                          <p className="text-sm font-bold text-white mt-1.5 mb-0">{row.category}</p>
                          
                          <div className="flex items-center gap-4 text-[10px] text-slate-400 mt-1">
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3 text-slate-500" /> {row.facilityId} ({row.country})
                            </span>
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-500" /> Month {row.reportingMonth}/{row.reportingYear}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right Block: Quantities & Calculated Footprint Carbon Math */}
                      <div className="flex items-center gap-5">
                        
                        {/* Math Output */}
                        <div className="text-right">
                          <p className="text-[10px] text-slate-400 m-0">Calculated Footprint</p>
                          <p className="text-base font-extrabold text-white mt-0.5 mb-0">
                            {row.emissionsKgs.toLocaleString()} <span className="text-xs font-normal text-slate-400">kg CO2e</span>
                          </p>
                          <p className="text-[10px] text-slate-500 mt-0.5">
                            {row.originalValue.toLocaleString()} {row.originalUnit}
                          </p>
                        </div>

                        {/* Badges / Controls status indicator */}
                        <div className="flex items-center gap-2.5">
                          {row.status === 'APPROVED' ? (
                            <span className="flex items-center gap-1 bg-teal-950/50 border border-teal-500/30 text-teal-400 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              <Lock className="w-3 h-3" /> Certified & Locked
                            </span>
                          ) : hasCriticalError ? (
                            <span className="flex items-center gap-1 bg-rose-950/50 border border-rose-500/30 text-rose-400 text-[10px] font-bold px-2.5 py-1 rounded-full animate-pulse">
                              <XCircle className="w-3 h-3" /> Critical Error
                            </span>
                          ) : hasUnresolvedIssues ? (
                            <span className="flex items-center gap-1 bg-amber-950/50 border border-amber-500/30 text-amber-500 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              <AlertTriangle className="w-3 h-3" /> Suspicious Flag
                            </span>
                          ) : (
                            <span className="bg-slate-900 border border-slate-800 text-slate-400 text-[10px] font-bold px-2.5 py-1 rounded-full">
                              Pending Review
                            </span>
                          )}

                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
                        </div>

                      </div>
                    </div>

                    {/* EXPANDED COMPLIANCE PANEL (DETAILS MATCHING GRID + EDIT FORM + AUDIT LOG) */}
                    {isExpanded && (
                      <div className="border-t border-slate-800 bg-slate-950/60 p-6 space-y-6">
                        
                        {/* Alert Blocks: Unresolved Warnings/Errors */}
                        {row.issues.length > 0 && (
                          <div className="space-y-2.5">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <AlertTriangle className="w-4 h-4 text-amber-500" /> Pipeline Verification Warnings ({row.issues.filter(i => !i.resolved).length} Unresolved)
                            </h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {row.issues.map((issue, idx) => (
                                <div 
                                  key={idx}
                                  className={`p-3.5 rounded-lg border text-xs flex justify-between items-start gap-4 ${
                                    issue.resolved 
                                      ? 'bg-slate-900/30 border-slate-800 text-slate-300' 
                                      : issue.type === 'ERROR' 
                                      ? 'bg-rose-950/15 border-rose-900/40 text-rose-300' 
                                      : 'bg-amber-950/15 border-amber-900/40 text-amber-300'
                                  }`}
                                >
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                        issue.resolved 
                                          ? 'bg-slate-800 text-slate-400' 
                                          : issue.type === 'ERROR' 
                                          ? 'bg-rose-900 text-rose-100' 
                                          : 'bg-amber-900 text-amber-100'
                                      }`}>
                                        {issue.type}
                                      </span>
                                      <span className="font-bold text-slate-200">Field: {issue.field}</span>
                                    </div>
                                    <p className="mt-1.5 leading-relaxed text-[11px] text-slate-300">{issue.message}</p>
                                    
                                    {issue.resolved && (
                                      <p className="text-[10px] text-teal-400 mt-2">
                                        ✓ Resolved by {issue.resolvedBy} at {new Date(issue.resolvedAt!).toLocaleString()}
                                      </p>
                                    )}
                                  </div>

                                  {!issue.resolved && !row.isLocked && (
                                    <div className="flex-shrink-0 text-right">
                                      {activeIssueIndex === idx ? (
                                        <div className="space-y-2 mt-2 w-48 bg-slate-900 p-2.5 rounded border border-slate-800">
                                          <textarea 
                                            placeholder="Auditable resolution diagnostics note..."
                                            value={resolutionNote}
                                            onChange={(e) => setResolutionNote(e.target.value)}
                                            className="w-full h-14 bg-slate-950 text-[10px] text-white p-1.5 rounded focus:outline-none focus:ring-1 focus:ring-teal-500 border border-slate-800 resize-none"
                                            required
                                          />
                                          <div className="flex justify-end gap-1">
                                            <button 
                                              onClick={() => setActiveIssueIndex(null)}
                                              className="bg-slate-800 text-[9px] px-2 py-1 rounded"
                                            >
                                              Cancel
                                            </button>
                                            <button 
                                              onClick={() => resolveTargetIssue(row.id, idx)}
                                              className="bg-teal-500 text-slate-950 font-bold text-[9px] px-2 py-1 rounded"
                                            >
                                              Resolve Flag
                                            </button>
                                          </div>
                                        </div>
                                      ) : (
                                        <button 
                                          onClick={() => {
                                            setActiveIssueIndex(idx);
                                            setResolutionNote('');
                                          }}
                                          className="text-[10px] font-bold bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 px-3 py-1.5 rounded transition-all cursor-pointer"
                                        >
                                          Resolve Alert
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* COMPLIANCE CORE PANELS GRID */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          
                          {/* Raw Payloads */}
                          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 font-mono text-[11px]">
                            <h4 className="font-sans text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                              <FileText className="w-4 h-4 text-slate-500" /> Original Source Raw Payload
                            </h4>
                            <div className="bg-slate-900/80 rounded border border-slate-800 p-3 max-h-56 overflow-y-auto text-slate-300">
                              <pre>{JSON.stringify(row.rawRowData, null, 2)}</pre>
                            </div>
                            <div className="mt-2 text-[10px] text-slate-500 flex items-center justify-between">
                              <span>Trace Reference ID: {row.id}</span>
                              <span>Year Format: Raw</span>
                            </div>
                          </div>

                          {/* Certified Calculations */}
                          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-4">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest flex items-center gap-2">
                              <Sparkles className="w-4 h-4 text-teal-400" /> Emissions Audit Normalization
                            </h4>
                            
                            <div className="bg-teal-950/15 border border-teal-500/20 p-3.5 rounded-lg">
                              <p className="text-[10px] uppercase font-bold tracking-wider text-teal-400">Emission Factor applied</p>
                              <p className="text-sm font-semibold text-teal-300 mt-1">
                                {row.emissionFactor} kg CO2e / {row.normalizedUnit}
                              </p>
                              <div className="h-px bg-slate-800/80 my-2" />
                              <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Auditable Equation Formula</p>
                              <p className="text-xs italic text-slate-300 font-mono mt-1 mt-0.5 leading-relaxed bg-slate-900 p-2 rounded border border-slate-800">
                                {row.calculationFormula}
                              </p>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                              <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                                <span className="text-[9px] text-slate-500 uppercase font-bold">Stated Input Intake</span>
                                <p className="text-sm font-bold text-white mt-1">{row.originalValue.toLocaleString()} {row.originalUnit}</p>
                              </div>
                              <div className="p-2.5 bg-slate-900 rounded border border-slate-800">
                                <span className="text-[9px] text-teal-500 uppercase font-bold">Normalized Activity</span>
                                <p className="text-sm font-bold text-teal-300 mt-1">{row.normalizedValue.toLocaleString()} {row.normalizedUnit}</p>
                              </div>
                            </div>
                          </div>

                        </div>

                        {/* EDIT SECTION SHIFT FOR ANALYST */}
                        {!row.isLocked && (
                          <div className="bg-slate-900 border border-slate-850 p-4 rounded-lg">
                            {editMode ? (
                              <div className="space-y-4">
                                <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
                                  <Edit2 className="w-4 h-4 text-teal-400" /> Re-Normalization Intake Form
                                </h4>
                                
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                  <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Activity Quantity</label>
                                    <input 
                                      type="number" 
                                      value={editQty}
                                      onChange={(e) => setEditQty(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      placeholder="Menge (e.g. 15000)"
                                    />
                                  </div>

                                  <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Raw Base Unit</label>
                                    <input 
                                      type="text" 
                                      value={editUnit}
                                      onChange={(e) => setEditUnit(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      placeholder="Einheit (e.g. L, GAL)"
                                    />
                                  </div>

                                  <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Facility / Meter / Route</label>
                                    <input 
                                      type="text" 
                                      value={editFacility}
                                      onChange={(e) => setEditFacility(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      placeholder="Werk / ID (e.g. DE_PL_102)"
                                    />
                                  </div>

                                  <div>
                                    <label className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Country Sovereign Code</label>
                                    <input 
                                      type="text" 
                                      value={editCountry}
                                      onChange={(e) => setEditCountry(e.target.value)}
                                      className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-teal-500"
                                      placeholder="ISO Country (e.g. DE)"
                                    />
                                  </div>
                                </div>

                                {/* Special helper for SAP Material Mapping corrections */}
                                {row.sourceType === 'SAP' && (
                                  <div className="p-3 bg-slate-950 border border-slate-800 rounded">
                                    <label className="text-[10px] uppercase text-slate-400 font-bold block mb-1">Correct SAP Material Catalog Sync</label>
                                    <select 
                                      value={overrideMaterialCode}
                                      onChange={(e) => setOverrideMaterialCode(e.target.value)}
                                      className="bg-slate-900 border border-slate-700 rounded text-xs p-1.5 text-slate-300 focus:outline-none"
                                    >
                                      <option value="MAT-DSL-001">MAT-DSL-001 — Diesel Fuel (Stationary Scope 1)</option>
                                      <option value="MAT-DSL-MOB">MAT-DSL-MOB — Diesel Fuel (Fleet Mobile Scope 1)</option>
                                      <option value="MAT-COA-002">MAT-COA-002 — Bituminous Coal (Stationary Scope 1)</option>
                                      <option value="MAT-OFFCE-99">MAT-OFFCE-99 — Office Supplies (Spend Scope 3 Category 1)</option>
                                      <option value="MAT-COA-X">MAT-COA-X [Unmapped Out-of-sync SKU - Triggers Mapping Alert]</option>
                                    </select>
                                    <p className="text-[10px] text-slate-500 mt-1.5 m-0">Corrects the raw Material block catalog code inside SAP and forces automated coefficient lookups again.</p>
                                  </div>
                                )}

                                <div className="flex gap-2 justify-end">
                                  <button 
                                    onClick={() => setEditMode(false)}
                                    className="bg-slate-800 px-3.5 py-1.5 text-xs rounded border border-slate-700 text-slate-400 hover:text-white"
                                  >
                                    Cancel
                                  </button>
                                  <button 
                                    onClick={() => saveInlineEdit(row.id)}
                                    className="bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold px-3.5 py-1.5 text-xs rounded"
                                  >
                                    Run Engine Recalculation
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-between">
                                <div>
                                  <p className="text-xs font-bold text-white m-0">Inconsistent or corrupt quantities detected?</p>
                                  <p className="text-[10px] text-slate-400 m-0">Run a recalculation by overriding raw measurements through our mapping parser.</p>
                                </div>
                                <button 
                                  onClick={() => setEditMode(true)}
                                  className="flex items-center gap-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-705 text-white border border-slate-700 px-3.5 py-2 rounded transitional-all cursor-pointer"
                                >
                                  <Edit2 className="w-3.5 h-3.5 text-teal-400" /> Adjust Values
                                </button>
                              </div>
                            )}
                          </div>
                        )}

                        {/* COMPATIBLE AUDIT TRAILS */}
                        <div className="space-y-3">
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest">Chronological Security Audit Log</h4>
                          <div className="bg-slate-900 rounded-lg p-3 border border-slate-800 space-y-3 max-h-40 overflow-y-auto font-mono text-[10px]">
                            {row.auditTrail.map((log, logIdx) => (
                              <div key={`${log.id}-${logIdx}`} className="pb-1.5 border-b border-slate-800/60 last:border-0 last:pb-0">
                                <div className="flex items-center justify-between text-slate-400">
                                  <span className="text-teal-400 font-bold uppercase">[{log.action}]</span>
                                  <span>{log.userName} (ID: {log.userId})</span>
                                  <span>{new Date(log.timestamp).toLocaleString()}</span>
                                </div>
                                <p className="text-slate-300 ml-4 mt-1 font-sans">{log.notes}</p>
                                
                                {log.previousValue && (
                                  <p className="text-slate-500 ml-4 mt-1 overflow-x-auto bg-slate-950 p-1.5 rounded border border-slate-800 limit-scroll">
                                    <span className="text-rose-400">Previous:</span> {log.previousValue}<br />
                                    <span className="text-teal-400">Current:</span> {log.newValue}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {/* APPROVE ACTION PANEL */}
                        {row.status === 'PENDING' && (
                          <div className="pt-4 border-t border-slate-800 flex items-center justify-between gap-4">
                            <p className="text-xs text-slate-400">
                              By approving or locking, you sign-off on the integrity of this row, locking it permanently for auditor viewing.
                            </p>
                            <button 
                              onClick={() => approveAndLockRow(row.id)}
                              disabled={hasCriticalError}
                              className={`flex items-center gap-1.5 text-xs px-5 py-2.5 rounded-lg border font-bold ${
                                hasCriticalError 
                                  ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' 
                                  : 'bg-teal-500 hover:bg-teal-400 text-slate-950 border-teal-500 cursor-pointer'
                              }`}
                            >
                              <CheckCircle className="w-4 h-4" /> Certify & Lock Record
                            </button>
                          </div>
                        )}

                      </div>
                    )}

                  </div>
                );
              })
            )}
          </div>

        </div>

        {/* RIGHT COLUMN: MANUAL INGESTION WATERFALL/SANDBOX TERMINAL */}
        <div className="space-y-6">
          
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-teal-400" />
              <h2 className="text-base font-bold text-white m-0">Bulk Manual Ingest Port</h2>
            </div>
            <p className="text-xs text-slate-400">
              Drag-files, or paste realistic flat formats directly below to run normalization validation logic.
            </p>

            {/* CHANNEL SOURCE CHOICE */}
            <div className="grid grid-cols-3 gap-2">
              {(['SAP', 'UTILITY', 'TRAVEL'] as SourceType[]).map((src) => (
                <button
                  key={src}
                  onClick={() => {
                    setSelectedPresetSource(src);
                    selectRawPreset(RAW_TEMPLATES[src][0].data);
                  }}
                  className={`py-2 text-xs font-bold rounded-lg border transition-all cursor-pointer ${
                    selectedPresetSource === src 
                      ? 'bg-teal-950/40 border-teal-500 text-teal-400 shadow-md shadow-teal-500/5' 
                      : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-705'
                  }`}
                >
                  {src} Mode
                </button>
              ))}
            </div>

            {/* QUICK PRESETS IN THE CURRENT MODE */}
            <div className="space-y-1.5">
              <label className="text-[10px] uppercase text-slate-500 font-bold block">Available Ingestion Templates</label>
              <div className="space-y-2">
                {RAW_TEMPLATES[selectedPresetSource].map((preset, pIdx) => (
                  <button 
                    key={pIdx}
                    onClick={() => selectRawPreset(preset.data)}
                    className="w-full text-left bg-slate-900 hover:bg-slate-850 p-2 text-[11px] rounded border border-slate-800 hover:border-slate-700 flex justify-between items-center text-slate-300 transition-all cursor-pointer"
                  >
                    <span>{preset.label}</span>
                    <Plus className="w-3.5 h-3.5 text-teal-400 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </div>

            {/* PASTE EDITOR CONTAINER */}
            <div className="relative">
              <label className="text-[10px] uppercase text-slate-500 font-bold block mb-1">Raw JSON Source Payload</label>
              <textarea 
                value={manualJsonText}
                onChange={(e) => setManualJsonText(e.target.value)}
                className="w-full h-80 bg-slate-900 text-slate-200 border border-slate-800 rounded-lg p-3 font-mono text-xs focus:ring-1 focus:ring-teal-500 focus:outline-none focus:border-slate-600 resize-y"
              />
              <span className="absolute bottom-3 right-3 text-[10px] text-slate-600 uppercase font-mono tracking-widest">
                JSON
              </span>
            </div>

            {/* TRIGGERS */}
            <button 
              id="submit-ingest-button"
              onClick={handleIngest}
              className="w-full bg-teal-500 hover:bg-teal-400 text-slate-950 font-bold hover:shadow-lg hover:shadow-teal-500/10 transition-all py-3 rounded-xl flex items-center justify-center gap-2 cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Run Ingestion Engine
            </button>
          </div>

          {/* SYSTEM NOTES CARD */}
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-5 shadow-lg space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400 m-0">Compliance Auditor Instructions</h3>
            
            <div className="space-y-3.5 text-xs text-slate-300 leading-relaxed">
              <p>
                This terminal represents operational processes of <strong>Breathe ESG</strong>. The data contains raw metrics featuring inconsistencies designed to test mathematical compliance:
              </p>
              <ul className="list-disc pl-4 space-y-2">
                <li>
                  <strong className="text-indigo-400">SAP Fuel Ingestion</strong> handles German fields and decimal syntax, correcting unmapped chemical SKUs.
                </li>
                <li>
                  <strong className="text-amber-400">Utility Allocator</strong> parses raw meter reading offsets, aligning overlapping dates with calendar months.
                </li>
                <li>
                  <strong className="text-teal-400">Travel Calculator</strong> computes Haversine coordinates and cabin emission density factors.
                </li>
              </ul>
              <p className="text-[11px] text-slate-400 italic">
                Note: Approving a row permanently signs off and creates an immutable audit lock.
              </p>
            </div>
          </div>

        </div>

      </main>

    </div>
  );
}
