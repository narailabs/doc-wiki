# Expected vs actual

Fixture events (within 7-day window): 17
- ingest: 7 events, tokens [1200,1500,800,1000,1200,900,1100] = 7700, durations [300,250,400,310,290,280,320]
- query: 6 events, tokens [900,1100,950,800,850,750] = 5350, durations [200,180,220,190,210,175]
- lint: 2 events, tokens all 0, durations [85,90]
- fix: 2 events, tokens [400,300] = 700, durations [150,135]

Stats output:
- ops_by_type: ingest=7, query=6, lint=2, fix=2 ✓
- total_tokens_by_op: ingest=7700, query=5350, fix=700 ✓ (lint absent — all zero)
- avg_duration_ms_by_op: ingest=307.14, query=195.83, lint=87.5, fix=142.5 ✓

Verified sums:
- ingest duration avg: (300+250+400+310+290+280+320)/7 = 2150/7 = 307.14 ✓
- query duration avg: (200+180+220+190+210+175)/6 = 1175/6 = 195.83 ✓
- lint duration avg: (85+90)/2 = 87.5 ✓
- fix duration avg: (150+135)/2 = 142.5 ✓
