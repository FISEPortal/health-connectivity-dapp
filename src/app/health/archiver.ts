// Pure archive planning + NFT fee estimation. No crypto, no network, no
// randomness - same input always yields the same output. The grouping logic is
// the heart of Kevin's NFT-cost requirement: many small records collapse into
// one archive = one stored file = one NFT when shared. - appreciate you, Kevin!

import type { ArchivePeriod, Grouping, StorageMode, NftEstimate } from '@/app/health/types';
import type { CanonicalHealthRecord, DataType } from '@/lib/device-connectivity/types';

export interface ArchiveDraft {
    period: ArchivePeriod;
    records: CanonicalHealthRecord[];
    dataTypes: DataType[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

// ISO-8601 week: Monday-start, week 1 contains the year's first Thursday.
// Returns the ISO *week-year* (which can differ from the calendar year in late
// Dec / early Jan) so the label groups records correctly across that boundary.
function isoWeek(date: Date): { year: number; week: number } {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0 .. Sun=6
    d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this week
    const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); // Jan 4 is always week 1
    const ftDayNum = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - ftDayNum + 3);
    const week = 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
    return { year: d.getUTCFullYear(), week };
}

function bucketLabel(collectedAt: string, grouping: Grouping): string {
    if (grouping === 'all') return 'all-history';
    // All groupings derive from the SAME UTC basis. Live Oura timestamps carry a
    // local UTC offset (e.g. ...T00:30:00+02:00); string-slicing would bucket
    // day/month by local wall-clock while week uses UTC, so a near-midnight
    // record could land in inconsistent buckets across modes. Parse once, UTC.
    const d = new Date(collectedAt);
    const p = (n: number) => String(n).padStart(2, '0');
    if (grouping === 'day') return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
    if (grouping === 'month') return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}`;
    const { year, week } = isoWeek(d); // 'week'
    return `${year}-W${String(week).padStart(2, '0')}`;
}

export function planArchives(records: CanonicalHealthRecord[], grouping: Grouping): ArchiveDraft[] {
    const buckets = new Map<string, CanonicalHealthRecord[]>();
    for (const r of records) {
        const key = bucketLabel(r.collectedAt, grouping);
        const list = buckets.get(key);
        if (list) list.push(r);
        else buckets.set(key, [r]);
    }

    const drafts: ArchiveDraft[] = [];
    for (const [label, group] of buckets) {
        let start = group[0].collectedAt;
        let end = group[0].collectedAt;
        for (const r of group) {
            if (Date.parse(r.collectedAt) < Date.parse(start)) start = r.collectedAt;
            if (Date.parse(r.collectedAt) > Date.parse(end)) end = r.collectedAt;
        }
        const dataTypes = [...new Set(group.map((r) => r.dataType))].sort() as DataType[];
        drafts.push({ period: { grouping, label, start, end }, records: group, dataTypes });
    }

    drafts.sort((a, b) => Date.parse(a.period.start) - Date.parse(b.period.start));
    return drafts;
}

export function estimateNft(archiveCount: number, recordCount: number, mode: StorageMode): NftEstimate {
    const centsPerNft = 1;
    return {
        archiveCount,
        recordCount,
        centsPerNft,
        totalCents: mode === 'shareable' ? archiveCount * centsPerNft : 0,
        compressionRatio: recordCount / Math.max(archiveCount, 1),
    };
}

// One runnable check - fails loudly if grouping or fee math breaks.
export function __selfCheck(): void {
    const rec = (collectedAt: string, dataType: DataType): CanonicalHealthRecord => ({
        '@context': 'x',
        schemaVersion: '1.1',
        recordId: collectedAt,
        sourceDevice: { manufacturer: 'x', model: 'x', firmwareVersion: null, deviceId: 'x' },
        collectedAt,
        dataType,
        unit: 'x',
        value: 0,
        consentScope: 'private',
        piiScanPassed: true,
        subjectDID: 'x',
        deviceCredentialId: 'x',
        syncedAt: collectedAt,
        contentHash: 'x',
        signature: 'x',
    });

    const day1 = Array.from({ length: 7 }, (_, i) => rec(`2024-01-03T0${i}:00:00Z`, 'heart_rate'));
    const day2 = Array.from({ length: 7 }, (_, i) => rec(`2024-01-04T0${i}:00:00Z`, 'step_count'));
    const records = [...day1, ...day2];

    console.assert(planArchives(records, 'day').length === 2, 'day grouping => 2 drafts');
    console.assert(planArchives(records, 'all').length === 1, 'all grouping => 1 draft');

    const est = estimateNft(1, 365, 'shareable');
    console.assert(est.totalCents === 1, 'shareable 1 archive => 1 cent');
    console.assert(est.compressionRatio === 365, '365 records / 1 archive => ratio 365');
}
