// Plain-language labels so non-technical users see "Sleep" and "Blood oxygen",
// never "sleep_session" or "spo2". Single source of product copy for data types.

export const DATA_TYPE_LABELS: Record<string, string> = {
    heart_rate: 'Heart rate',
    hrv_rmssd: 'Heart rate variability',
    hrv_sdnn: 'Heart rate variability',
    spo2: 'Blood oxygen',
    sleep_session: 'Sleep',
    step_count: 'Steps',
    active_energy: 'Active energy',
    respiratory_rate: 'Breathing rate',
    body_temperature: 'Body temperature',
    readiness_score: 'Readiness',
};

export function friendlyDataType(dataType: string): string {
    return DATA_TYPE_LABELS[dataType] ?? dataType.replace(/_/g, ' ');
}
