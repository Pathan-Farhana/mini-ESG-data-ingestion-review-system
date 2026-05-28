/**
 * Breathe ESG - Ingestion and Emissions Math Engine
 * Translates real-world SAP, Utility, and Travel profiles to normalized Scope 1/2/3 values.
 */

import { NormalizedESGRow, SourceType, ScopeType, ValidationIssue, AuditTrailEntry } from './types.ts';

// Airport coordinate mapping (lat, lon)
const AIRPORT_COORDINATES: Record<string, [number, number]> = {
  SFO: [37.619, -122.375],
  JFK: [40.640, -73.778],
  LHR: [51.470, -0.461],
  DXB: [25.253, 55.364],
  CDG: [49.009, 2.550],
  HND: [35.549, 139.780],
  SIN: [1.364, 103.994],
  SYD: [-33.946, 151.177],
  FRA: [50.033, 8.570],
  MUC: [48.354, 11.786],
  BOM: [19.089, 72.868],
  AMS: [52.308, 4.764],
};

// EPA eGRID and international utility subregion grid mix emission factors (kg CO2e per kWh)
export const GRID_EMISSION_FACTORS: Record<string, { factor: number; regionName: string; country: string }> = {
  DE_PL_102: { factor: 0.35, regionName: 'Germany Grid (E.ON / RWE Network Mix)', country: 'DE' },
  US_PL_901: { factor: 0.42, regionName: 'ERCOT Texas (High Natural Gas/Coal)', country: 'US' },
  US_PL_702: { factor: 0.08, regionName: 'NPCC West (Pacific NW Hydro-Rich Mix)', country: 'US' },
  GB_PL_330: { factor: 0.22, regionName: 'National Grid UK (Combined Wind & Gas)', country: 'GB' },
  DEFAULT: { factor: 0.32, regionName: 'Global Grid Average', country: 'US' },
};

// Material lookups for SAP rows (Material Code -> emissions type and category)
export const SAP_MATERIAL_MAPPING: Record<string, {
  name: string;
  scope: ScopeType;
  category: string;
  baseFactor: number; // in kg CO2e per normalized unit
  normalizedUnit: string;
  conversion: (qty: number, unit: string) => { value: number; unit: string; warning?: string };
}> = {
  'MAT-DSL-001': {
    name: 'Diesel Fuel (Stationary)',
    scope: 'Scope 1',
    category: 'Scope 1 - Direct Stationary Combustion',
    baseFactor: 2.68, // kg CO2e per Liter of diesel
    normalizedUnit: 'Liters',
    conversion: (qty, unit) => {
      const u = unit.toUpperCase().trim();
      if (u === 'L' || u === 'LTR') return { value: qty, unit: 'Liters' };
      if (u === 'GAL' || u === 'GALLON') return { value: qty * 3.78541, unit: 'Liters' };
      if (u === 'M3') return { value: qty * 1000, unit: 'Liters' };
      return { value: qty, unit: 'Liters', warning: `Unsupported unit '${unit}' defaulted to Liters (1:1 conversion)` };
    }
  },
  'MAT-DSL-MOB': {
    name: 'Diesel Fuel (Fleet Mobile)',
    scope: 'Scope 1',
    category: 'Scope 1 - Direct Mobile Combustion',
    baseFactor: 2.51, // kg CO2e per Liter of mobile diesel
    normalizedUnit: 'Liters',
    conversion: (qty, unit) => {
      const u = unit.toUpperCase().trim();
      if (u === 'L' || u === 'LTR') return { value: qty, unit: 'Liters' };
      if (u === 'GAL' || u === 'GALLON') return { value: qty * 3.78541, unit: 'Liters' };
      return { value: qty, unit: 'Liters', warning: `Unsupported unit '${unit}' defaulted to Liters` };
    }
  },
  'MAT-COA-002': {
    name: 'Bituminous Coal',
    scope: 'Scope 1',
    category: 'Scope 1 - Direct Stationary Combustion',
    baseFactor: 2425.0, // kg CO2e per Metric Tonne
    normalizedUnit: 'Metric Tonnes',
    conversion: (qty, unit) => {
      const u = unit.toUpperCase().trim();
      if (u === 'TO' || u === 'TON') return { value: qty, unit: 'Metric Tonnes' };
      if (u === 'ST') return { value: qty * 0.907185, unit: 'Metric Tonnes' }; // SAP Short Ton (Standard US)
      if (u === 'KG') return { value: qty / 1000, unit: 'Metric Tonnes' };
      return { value: qty, unit: 'Metric Tonnes', warning: `Unsupported unit '${unit}' assumed Tonnes (1:1)` };
    }
  },
  'MAT-OFFCE-99': {
    name: 'Purchased Office Supplies',
    scope: 'Scope 3',
    category: 'Scope 3 - Category 1 (Purchased Goods and Services)',
    baseFactor: 0.15, // Spend-based factor: 0.15 kg CO2e per EUR/USD Spend
    normalizedUnit: 'Spend (USD)',
    conversion: (qty, unit) => {
      return { value: qty, unit: 'USD' }; // standard spend normalization
    }
  },
};

// Hotel emissions factor by country (kg CO2e per room-night)
export const HOTEL_FACTORS_BY_COUNTRY: Record<string, number> = {
  US: 18.2,
  DE: 22.4,
  GB: 14.8,
  FR: 8.5, // low due to dense nuclear energy grid
  JP: 25.1,
  AE: 32.7, // high due to desalination and air conditioning energy profiles
  DEFAULT: 20.0,
};

// Calculate Great Circle Distance in Kilometers
export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Map a flight distance tier and retrieve emissions factor (kg CO2e per passenger-kilometer)
function getFlightEmissionFactor(distanceKm: number, cabinClass: string): { factor: number; tier: string; multiplier: number } {
  let factor = 0.11; // long haul default
  let tier = 'Long Haul (>3700 km)';

  if (distanceKm < 480) {
    factor = 0.15; // short haul
    tier = 'Short Haul (<480 km)';
  } else if (distanceKm < 3700) {
    factor = 0.13; // medium haul
    tier = 'Medium Haul (480-3700 km)';
  }

  // Cabin business/first adjustments
  let multiplier = 1.0;
  const cc = cabinClass.toUpperCase().trim();
  if (cc === 'BUSINESS') {
    // Business seats occupy up to 2.9x space on long hauls (DEFRA standard)
    multiplier = distanceKm >= 3700 ? 2.9 : 1.5;
  } else if (cc === 'FIRST') {
    multiplier = 4.0;
  }

  return { factor, tier, multiplier };
}

// Apportion usage from overlapping billing dates into calendar months
export function apportionUtilityBilling(
  startDateStr: string,
  endDateStr: string,
  totalQty: number
): { year: number; month: number; daysAllocated: number; proportionValue: number }[] {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);

  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start >= end) {
    // Catch corrupt billing durations
    const fallbackYear = isNaN(start.getTime()) ? 2026 : start.getFullYear();
    const fallbackMonth = isNaN(start.getTime()) ? 5 : start.getMonth() + 1;
    return [{ year: fallbackYear, month: fallbackMonth, daysAllocated: 30, proportionValue: totalQty }];
  }

  const oneDayMs = 24 * 60 * 60 * 1000;
  const totalDays = Math.round((end.getTime() - start.getTime()) / oneDayMs);
  
  if (totalDays <= 0) {
    return [{ year: start.getFullYear(), month: start.getMonth() + 1, daysAllocated: 1, proportionValue: totalQty }];
  }

  const dailyQty = totalQty / totalDays;
  const distribution: Record<string, { year: number; month: number; days: number }> = {};

  // Tick through every sub-day
  const cursor = new Date(start);
  while (cursor < end) {
    const yr = cursor.getFullYear();
    const mo = cursor.getMonth() + 1; // 1-indexed
    const key = `${yr}-${mo.toString().padStart(2, '0')}`;
    
    if (!distribution[key]) {
      distribution[key] = { year: yr, month: mo, days: 0 };
    }
    distribution[key].days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }

  return Object.values(distribution).map((item) => ({
    year: item.year,
    month: item.month,
    daysAllocated: item.days,
    proportionValue: parseFloat((item.days * dailyQty).toFixed(2)),
  }));
}

/**
 * Normalizes flat rows from multiple sources into our core target ESG audit schema.
 * Flags suspicious deviations, incomplete metrics, and tracks state.
 */
export function normalizeIngestedRow(
  sourceType: SourceType,
  rawRow: Record<string, any>,
  tenantId: string,
  index: number
): NormalizedESGRow[] {
  const generatedRows: NormalizedESGRow[] = [];
  const targetId = `${sourceType.toLowerCase()}_${Date.now()}_${index}`;
  const issues: ValidationIssue[] = [];

  const baseRowTemplate = {
    tenantId,
    sourceType,
    status: 'PENDING' as const,
    isLocked: false,
    auditTrail: [] as AuditTrailEntry[],
    rawRowData: rawRow,
  };

  try {
    if (sourceType === 'SAP') {
      const bookDate = rawRow.Buchungsdatum || '';
      // Parse German date (DD.MM.YYYY)
      let parsedDate = '';
      let reportingYear = 2026;
      let reportingMonth = 5;

      if (bookDate.includes('.')) {
        const parts = bookDate.split('.');
        if (parts.length === 3) {
          parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
          reportingYear = parseInt(parts[2]) || 2026;
          reportingMonth = parseInt(parts[1]) || 5;
        }
      } else {
        const d = new Date(bookDate);
        if (!isNaN(d.getTime())) {
          parsedDate = bookDate;
          reportingYear = d.getFullYear();
          reportingMonth = d.getMonth() + 1;
        } else {
          parsedDate = '2026-05-28';
          issues.push({
            type: 'WARNING',
            field: 'Buchungsdatum',
            message: `Unrecognized German date format '${bookDate}'. Forced fall-back to current date.`,
            severity: 'medium',
            resolved: false,
          });
        }
      }

      // Read SAP Quantity
      let rawQtyStr = rawRow.Menge || '0';
      // Clean SAP notation: change german decimal comma "1.200,00" to "1200.00"
      if (rawQtyStr.includes(',') && rawQtyStr.includes('.')) {
        rawQtyStr = rawQtyStr.replace(/\./g, '').replace(',', '.');
      } else if (rawQtyStr.includes(',')) {
        rawQtyStr = rawQtyStr.replace(',', '.');
      }
      const quantity = parseFloat(rawQtyStr) || 0;
      const unit = rawRow.Einheit || 'L';
      const material = (rawRow.Material || '').toUpperCase().trim();
      const plant = rawRow.Werk || 'DE_PL_102';

      // Lookups
      const mapping = SAP_MATERIAL_MAPPING[material];
      if (!mapping) {
        // Material mapping fails! Register error issue
        const fallbackValue = quantity;
        generatedRows.push({
          ...baseRowTemplate,
          id: targetId,
          sourceRowId: rawRow.IDoc_Num || `IDOC-MOCK-${index}`,
          scope: 'Scope 1',
          category: 'Unmapped SAP Material',
          facilityId: plant,
          country: plant.startsWith('DE') ? 'DE' : 'US',
          originalDate: parsedDate,
          reportingYear,
          reportingMonth,
          originalValue: quantity,
          originalUnit: unit,
          normalizedValue: fallbackValue,
          normalizedUnit: unit,
          emissionFactor: 0,
          emissionsKgs: 0,
          calculationFormula: `0 kg CO2e * quantity (No mapping for material code '${material}')`,
          issues: [{
            type: 'ERROR',
            field: 'Material',
            message: `Material number '${material}' is not in Breathe ESG emission factors mapping table. High operational risk!`,
            severity: 'high',
            resolved: false,
          }],
        });
        return generatedRows;
      }

      const conversionResult = mapping.conversion(quantity, unit);
      if (conversionResult.warning) {
        issues.push({
          type: 'WARNING',
          field: 'Einheit',
          message: conversionResult.warning,
          severity: 'low',
          resolved: false,
        });
      }

      // Check plant grid mapping
      const grid = GRID_EMISSION_FACTORS[plant] || GRID_EMISSION_FACTORS.DEFAULT;
      const country = grid.country;

      // Fuel calculations
      const totalEmissionsKgs = conversionResult.value * mapping.baseFactor;
      const calculationFormula = `${conversionResult.value.toFixed(2)} ${conversionResult.unit} * ${mapping.baseFactor} (factor for ${mapping.name})`;

      // Flag anomalies (e.g. suspiciously huge fuel ingestion, >50,000 Liters)
      if (conversionResult.value > 50000 && material !== 'MAT-OFFCE-99') {
        issues.push({
          type: 'ANOMALY',
          field: 'Menge',
          message: `Ingested fuel quantity of ${conversionResult.value.toLocaleString()} ${conversionResult.unit} exceeds enterprise normal shift baseline limit (50,000). Needs analyst approval.`,
          severity: 'medium',
          resolved: false,
        });
      }

      generatedRows.push({
        ...baseRowTemplate,
        id: targetId,
        sourceRowId: rawRow.IDoc_Num || `IDOC-SAP-${index}`,
        scope: mapping.scope,
        category: mapping.category,
        facilityId: plant,
        country,
        originalDate: parsedDate,
        reportingYear,
        reportingMonth,
        originalValue: quantity,
        originalUnit: unit,
        normalizedValue: conversionResult.value,
        normalizedUnit: conversionResult.unit,
        emissionFactor: mapping.baseFactor,
        emissionsKgs: parseFloat(totalEmissionsKgs.toFixed(2)),
        calculationFormula,
        issues,
      });

    } else if (sourceType === 'UTILITY') {
      const meterId = rawRow.Meter_ID || 'METER-DEFAULT';
      const accountNum = rawRow.Account_Number || 'ACC-DEFAULT';
      const tariffCode = rawRow.Tariff_Code || 'COM_E_PRIMARY';
      const multiplier = parseFloat(rawRow.Multiplier) || 1.0;
      const prevRead = parseFloat(rawRow.Previous_Reading) || 0;
      const currRead = parseFloat(rawRow.Current_Reading) || 0;
      
      let statedKwh = parseFloat(rawRow.Usage_kWh) || 0;
      const calculatedKwh = (currRead - prevRead) * multiplier;

      if (statedKwh === 0 && calculatedKwh > 0) {
        statedKwh = calculatedKwh;
      } else if (statedKwh > 0 && Math.abs(statedKwh - calculatedKwh) > 1.0) {
        issues.push({
          type: 'ANOMALY',
          field: 'Usage_kWh',
          message: `Utility stated usage (${statedKwh} kWh) deviates from meter difference calculation ((${currRead} - ${prevRead}) * ${multiplier} = ${calculatedKwh} kWh). Standard audit risk.`,
          severity: 'high',
          resolved: false,
        });
      }

      // Check Billing span
      const start = rawRow.Start_Date || '';
      const end = rawRow.End_Date || '';
      
      const partsArr = apportionUtilityBilling(start, end, statedKwh);

      // Create apportioned monthly rows to handle calendar month alignment!
      partsArr.forEach((apportioned, subIdx) => {
        const subId = `${targetId}__${subIdx}`;
        const subIssues = [...issues];

        // Plant and grid lookup matching meter facility identifier (using Account/Meter as plant proxy fallback)
        const plant = rawRow.Meter_ID === 'MET-9910023' ? 'US_PL_901' : 
                      rawRow.Meter_ID === 'MET-DE-820' ? 'DE_PL_102' :
                      rawRow.Meter_ID === 'MET-WA-001' ? 'US_PL_702' : 'GB_PL_330';

        const grid = GRID_EMISSION_FACTORS[plant] || GRID_EMISSION_FACTORS.DEFAULT;
        const emissionsKgs = apportioned.proportionValue * grid.factor;

        // Flag if billing duration spans too wide (>45 days)
        const startD = new Date(start);
        const endD = new Date(end);
        if (!isNaN(startD.getTime()) && !isNaN(endD.getTime())) {
          const billingDays = Math.round((endD.getTime() - startD.getTime()) / (24 * 60 * 60 * 1000));
          if (billingDays > 45) {
            subIssues.push({
              type: 'WARNING',
              field: 'Billing_Period',
              message: `Utility billing period is unusually long (${billingDays} days). Normal utility cycle is 28-33 days.`,
              severity: 'low',
              resolved: false,
            });
          }
        }

        const formula = `${apportioned.proportionValue.toFixed(1)} kWh (Allocated ${apportioned.daysAllocated} days in month ${apportioned.month}) * ${grid.factor} kg/kWh (${grid.regionName})`;

        generatedRows.push({
          ...baseRowTemplate,
          id: subId,
          sourceRowId: accountNum,
          scope: 'Scope 2',
          category: 'Scope 2 - Purchased Electricity (Location-Based)',
          facilityId: meterId,
          country: grid.country,
          originalDate: start,
          billingPeriodStart: start,
          billingPeriodEnd: end,
          reportingYear: apportioned.year,
          reportingMonth: apportioned.month,
          originalValue: statedKwh,
          originalUnit: 'kWh',
          normalizedValue: apportioned.proportionValue,
          normalizedUnit: 'kWh',
          emissionFactor: grid.factor,
          emissionsKgs: parseFloat(emissionsKgs.toFixed(2)),
          calculationFormula: formula,
          issues: subIssues,
        });
      });

    } else if (sourceType === 'TRAVEL') {
      const pnr = rawRow.Booking_Ref || 'PNR-MOCK';
      const employee = rawRow.Employee_ID || 'EMP-UNKNOWN';
      const category = rawRow.Travel_Type || 'Flight';
      const spend = parseFloat(rawRow.Spend_Amount_USD) || 0;

      if (category.toLowerCase() === 'flight') {
        const origin = (rawRow.Origin_Airport || '').toUpperCase().trim();
        const dest = (rawRow.Destination_Airport || '').toUpperCase().trim();
        const cabin = rawRow.Cabin_Class || 'Economy';

        const c1 = AIRPORT_COORDINATES[origin];
        const c2 = AIRPORT_COORDINATES[dest];

        if (!c1 || !c2) {
          // Missing coordinate resolver. Use default spend-based lookup to not block ingestion, but flag error
          const fallbackKm = spend * 4.2; // fallback rough km estimation from cost
          const calcResult = getFlightEmissionFactor(fallbackKm, cabin);
          const emissionsKgs = fallbackKm * calcResult.factor * calcResult.multiplier;

          generatedRows.push({
            ...baseRowTemplate,
            id: targetId,
            sourceRowId: pnr,
            scope: 'Scope 3',
            category: 'Scope 3 - Category 6 (Business Travel - Flights)',
            facilityId: 'Corporate Travel Engine',
            country: 'US',
            originalDate: '2026-05-28',
            reportingYear: 2026,
            reportingMonth: 5,
            originalValue: spend,
            originalUnit: 'USD',
            normalizedValue: parseFloat(fallbackKm.toFixed(1)),
            normalizedUnit: 'Passenger-Kilometers (Est)',
            emissionFactor: calcResult.factor,
            emissionsKgs: parseFloat(emissionsKgs.toFixed(2)),
            calculationFormula: `${fallbackKm.toFixed(0)} pkm (Est via $${spend} spend) * factor: ${calcResult.factor} pkm * class mult: ${calcResult.multiplier}x`,
            issues: [{
              type: 'ERROR',
              field: 'Origin_Airport',
              message: `Unrecognized airport code mapping (${origin} -> ${dest}). Great-circle distance calculation aborted. Substituted spend-based estimation.`,
              severity: 'medium',
              resolved: false,
            }],
          });
        } else {
          // Perfect Haversine
          const km = calculateDistance(c1[0], c1[1], c2[0], c2[1]);
          const { factor, tier, multiplier } = getFlightEmissionFactor(km, cabin);
          const emissionsKgs = km * factor * multiplier;

          // Flag if ultra-long travel
          if (km > 12000) {
            issues.push({
              type: 'ANOMALY',
              field: 'Cabin_Class',
              message: `Flight distance (${km.toFixed(0)} km) is unusually long (Segment: ${origin} -> ${dest}). Auditor warning.`,
              severity: 'low',
              resolved: false,
            });
          }

          generatedRows.push({
            ...baseRowTemplate,
            id: targetId,
            sourceRowId: pnr,
            scope: 'Scope 3',
            category: 'Scope 3 - Category 6 (Business Travel - Flights)',
            facilityId: `Route: ${origin}-${dest}`,
            country: origin === 'LHR' || dest === 'LHR' ? 'GB' : origin === 'CDG' || dest === 'CDG' ? 'FR' : 'US',
            originalDate: '2026-05-28',
            reportingYear: 2026,
            reportingMonth: 5,
            originalValue: km,
            originalUnit: 'Passenger-Kilometers',
            normalizedValue: parseFloat(km.toFixed(1)),
            normalizedUnit: 'Passenger-Kilometers',
            emissionFactor: factor,
            emissionsKgs: parseFloat(emissionsKgs.toFixed(2)),
            calculationFormula: `${km.toFixed(1)} km * DEFRA ${tier} factor: ${factor} * Cabin adjustment: ${multiplier}x (${cabin})`,
            issues,
          });
        }

      } else if (category.toLowerCase() === 'hotel') {
        const nights = parseInt(rawRow.Hotel_Nights) || 1;
        const hotelCountry = (rawRow.Hotel_Country || 'US').toUpperCase().trim();
        const factor = HOTEL_FACTORS_BY_COUNTRY[hotelCountry] || HOTEL_FACTORS_BY_COUNTRY.DEFAULT;
        const emissionsKgs = nights * factor;

        generatedRows.push({
          ...baseRowTemplate,
          id: targetId,
          sourceRowId: pnr,
          scope: 'Scope 3',
          category: 'Scope 3 - Category 6 (Business Travel - Hotels)',
          facilityId: `Hotel stay (${hotelCountry})`,
          country: hotelCountry,
          originalDate: '2026-05-28',
          reportingYear: 2026,
          reportingMonth: 5,
          originalValue: nights,
          originalUnit: 'Nights',
          normalizedValue: nights,
          normalizedUnit: 'Room-Nights',
          emissionFactor: factor,
          emissionsKgs: parseFloat(emissionsKgs.toFixed(2)),
          calculationFormula: `${nights} room-night(s) * Hotel factor: ${factor} kg CO2e/night (${hotelCountry})`,
          issues,
        });

      } else {
        // Ground transport fallback / Taxi / Train
        const type = (rawRow.Ground_Type || 'Taxi').trim();
        const factor = type.toLowerCase() === 'train' ? 0.04 : 0.20; // DEFRA spend-based factors for ground categories
        const emissionsKgs = spend * factor;

        generatedRows.push({
          ...baseRowTemplate,
          id: targetId,
          sourceRowId: pnr,
          scope: 'Scope 3',
          category: 'Scope 3 - Category 6 (Business Travel - Ground)',
          facilityId: `Ground: ${type}`,
          country: 'US',
          originalDate: '2026-05-28',
          reportingYear: 2026,
          reportingMonth: 5,
          originalValue: spend,
          originalUnit: 'USD',
          normalizedValue: spend,
          normalizedUnit: 'Spend (USD)',
          emissionFactor: factor,
          emissionsKgs: parseFloat(emissionsKgs.toFixed(2)),
          calculationFormula: `$${spend} US-dollar spend * DEFRA Ground: ${type} factor: ${factor} kg/USD`,
          issues,
        });
      }
    }
  } catch (error: any) {
    // Critical extraction error. Guard pipeline from crashing
    generatedRows.push({
      ...baseRowTemplate,
      id: targetId,
      sourceRowId: `INGEST-FAIL-${index}`,
      scope: 'Scope 1',
      category: 'Unprocessed Ingest Failure',
      facilityId: 'Ingestion pipeline',
      country: 'US',
      originalDate: '2026-05-28',
      reportingYear: 2026,
      reportingMonth: 5,
      originalValue: 0,
      originalUnit: 'Unrecognized',
      normalizedValue: 0,
      normalizedUnit: 'Unrecognized',
      emissionFactor: 0,
      emissionsKgs: 0,
      calculationFormula: `Aborted due to parsing exception: ${error.message}`,
      issues: [{
        type: 'ERROR',
        field: 'Row Ingestion',
        message: `Pipeline encountered a critical parsing failure: ${error.message}`,
        severity: 'high',
        resolved: false,
      }],
    });
  }

  return generatedRows;
}
