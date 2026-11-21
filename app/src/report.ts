// PDF report of the current setup: plot, deed check, roads, rules, and every concept with its
// 3D snapshot, pass/fail checklist and area schedule. Built in the browser with jsPDF.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { Ring } from './geo/geom'
import { dist } from './geo/geom'
import { type Analysis, type BuildingType, type Concept, type Road, type SystemSpec, HIGH_RISE_M, TYPES, fmt, roadSetback } from './rules/engine'
import type { DeedCheck } from './rules/deed'

export interface ReportInput {
  analysis: Analysis
  plot: Ring // local metres
  plotLL: [number, number][]
  plotArea: number
  roads: (Road | null)[]
  type: BuildingType
  system: SystemSpec
  nearStation: boolean
  bonusPct: number
  deed: DeedCheck | null
  shareLink: string
  shots: Record<string, string> // concept id -> PNG/JPEG data URL
}

// The built-in PDF fonts only cover Latin-1; spell out the symbols we use and drop Thai script.
export function pdfText(s: string): string {
  return s
    .replace(/ย\.8/g, 'Y.8')
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/→/g, '->')
    .replace(/[−–—]/g, '-')
    .replace(/✓/g, 'pass')
    .replace(/✕/g, 'fail')
    .replace(/[฀-๿]+/g, '')
    .replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '')
    .replace(/ {2,}/g, ' ')
    .trim()
}

const INK: [number, number, number] = [31, 26, 20]
const ACCENT: [number, number, number] = [234, 88, 12]
const MUTED: [number, number, number] = [110, 103, 95]

const rai = (m2: number) => {
  const r = Math.floor(m2 / 1600)
  const ngan = Math.floor((m2 - r * 1600) / 400)
  const wah = (m2 - r * 1600 - ngan * 400) / 4
  return `${r} rai ${ngan} ngan ${wah.toFixed(1)} sq wah`
}

function groupFloors(c: Concept) {
  const floors = c.blocks.flatMap((b) => b.floors).sort((x, y) => x.z0 - y.z0)
  const rows: string[][] = []
  let i = 0
  while (i < floors.length) {
    let j = i
    while (j + 1 < floors.length && floors[j + 1].use === floors[i].use && Math.abs(floors[j + 1].area - floors[i].area) < 1) j++
    const n = j - i + 1
    const area = floors.slice(i, j + 1).reduce((s, f) => s + f.area, 0)
    rows.push([n === 1 ? `L${i + 1}` : `L${i + 1}-${j + 1} (${n} x ${fmt(floors[i].area)})`, floors[i].use, `${fmt(floors[i].z0, 1)}-${fmt(floors[j].z1, 1)} m`, fmt(area)])
    i = j + 1
  }
  return rows
}

export function buildReport(r: ReportInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 14
  let y = M
  const a = r.analysis
  const L = a.limits
  const t = (s: string) => pdfText(s)
  const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
  const need = (h: number) => {
    if (y + h > H - 14) {
      doc.addPage()
      y = M
    }
  }
  const heading = (s: string) => {
    need(14)
    doc.setFont('helvetica', 'bold').setFontSize(13).setTextColor(...INK)
    doc.text(t(s), M, y + 5)
    doc.setDrawColor(...ACCENT).setLineWidth(0.6).line(M, y + 7.5, M + 18, y + 7.5)
    y += 12
  }
  const para = (s: string, size = 9.5, colour = INK) => {
    doc.setFont('helvetica', 'normal').setFontSize(size).setTextColor(...colour)
    const lines = doc.splitTextToSize(t(s), W - 2 * M) as string[]
    need(lines.length * size * 0.42 + 2)
    doc.text(lines, M, y + size * 0.35)
    y += lines.length * size * 0.42 + 2
  }
  const table = (head: string[] | null, body: string[][], opts: Record<string, unknown> = {}) => {
    autoTable(doc, {
      startY: y,
      head: head ? [head.map(t)] : undefined,
      body: body.map((row) => row.map(t)),
      margin: { left: M, right: M },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, textColor: INK, lineColor: [225, 219, 210], lineWidth: 0.2 },
      headStyles: { fillColor: [245, 240, 232], textColor: INK, fontStyle: 'bold' },
      ...opts,
    })
    y = lastY() + 6
  }
  const image = (url: string | undefined, maxH: number) => {
    if (!url) return
    const props = doc.getImageProperties(url)
    const w = W - 2 * M
    const h = Math.min(maxH, (w * props.height) / props.width)
    const iw = (h * props.width) / props.height
    need(h + 4)
    doc.addImage(url, url.startsWith('data:image/png') ? 'PNG' : 'JPEG', M + (w - iw) / 2, y, iw, h)
    doc.setDrawColor(225, 219, 210).setLineWidth(0.2).rect(M + (w - iw) / 2, y, iw, h)
    y += h + 5
  }

  // Cover
  doc.setFillColor(...INK).rect(0, 0, W, 34, 'F')
  doc.setFont('helvetica', 'bold').setFontSize(20).setTextColor(255, 255, 255).text('Plot Envelope - Bangkok', M, 16)
  doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(249, 115, 22).text('Feasibility report: what the rules allow on this plot', M, 24)
  doc.setTextColor(220, 214, 205).setFontSize(8.5).text(new Date().toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short' }), W - M, 24, { align: 'right' })
  y = 42
  const best = a.concepts.filter((c) => !c.infeasible && c.checks.every((k) => k.pass !== false)).sort((x, y2) => y2.gfa - x.gfa)[0]
  table(null, [
    ['Zone', 'Y.8 (very high-density residential, brown), Bangkok Comprehensive Plan 2013 cl.15'],
    ['Plot area (drawn)', `${fmt(r.plotArea)} m2  (${rai(r.plotArea)})`],
    ['Building', `${TYPES[r.type].label}, ${r.system.name}`],
    ['Max floor area', `${fmt(L.gfaCap)} m2 (${L.gfaCapReason})`],
    ['Concepts', a.concepts.map((c) => `${c.name}: ${c.infeasible ? "doesn't fit" : c.checks.some((k) => k.pass === false) ? `${c.checks.filter((k) => k.pass === false).length} fail` : 'all pass'}`).join('\n')],
    ['Largest passing concept', best ? `${best.name}, ${fmt(best.gfa)} m2, FAR ${fmt(best.gfa / r.plotArea, 2)}, ${fmt(best.height, 1)} m` : 'None pass yet'],
  ], { columnStyles: { 0: { fontStyle: 'bold', cellWidth: 42 } }, theme: 'grid' })
  if (r.deed) {
    const col: [number, number, number] = r.deed.level === 'over' ? [185, 28, 28] : r.deed.level === 'under' ? [161, 98, 7] : [4, 120, 87]
    para(`Title deed check: deed ${fmt(r.deed.deedM2)} m2, drawn ${fmt(r.deed.drawnM2)} m2 (${r.deed.diffPct > 0 ? '+' : ''}${r.deed.diffPct.toFixed(1)}%). ${r.deed.message}`, 9.5, col)
    if (r.deed.level !== 'match') para(`By the deed, max floor area is ${fmt(L.farCap * r.deed.deedM2)} m2.`, 9, MUTED)
  }
  doc.setFont('helvetica', 'normal').setFontSize(8.5).setTextColor(37, 99, 235)
  need(6)
  doc.textWithLink('Open this exact setup in the tool', M, y + 3, { url: r.shareLink })
  y += 8
  image(r.shots[best?.id ?? a.concepts[0]?.id], 105)

  // Plot and roads
  heading('1. Plot and road frontage')
  table(
    ['Edge', 'Length', 'Faces a road?', 'Road width', 'Road setback', 'Road name'],
    r.plot.map((p, i) => {
      const road = r.roads[i]
      return [`${i + 1}`, `${fmt(dist(p, r.plot[(i + 1) % r.plot.length]), 1)} m`, road ? 'Yes' : 'No', road ? `${fmt(road.width, 1)} m` : '-', road ? `${fmt(roadSetback(road.width), 1)} m` : '-', road?.name ?? '-']
    }),
  )
  para(`Corners (longitude, latitude): ${r.plotLL.map(([x, yy]) => `${yy.toFixed(6)}, ${x.toFixed(6)}`).join('; ')}`, 7.5, MUTED)
  para(`Within 500 m of a BTS/MRT platform: ${r.nearStation ? 'yes' : 'no'}. FAR bonus claimed: ${r.bonusPct}%. Structure: ${r.system.name}, ${fmt(r.system.typH, 1)} m floor to floor.`, 9)

  // Rules
  heading('2. What the rules allow')
  table(
    ['Rule', 'Limit', 'Source'],
    [
      ['Max floor area', `${fmt(L.gfaCap)} m2 (${L.gfaCapReason})`, '2013 plan cl.15(1)'],
      ['Open space', `>= ${L.zone.osrPct}% of floor area (${fmt((L.zone.osrPct / 100) * L.gfaCap)} m2 at full FAR), half planted; and >= 30% of the largest floor`, '2013 plan cl.15(2); MR55 cl.33'],
      ['Height', `<= 2 x distance to the far side of the ${fmt(L.plane?.width ?? 0, 1)} m road (${fmt(2 * (L.plane?.width ?? 0))} m at the frontage; envelope peaks at ${fmt(a.high?.maxHeight ?? 0)} m)`, 'BKK Ord. 2544 cl.49'],
      ['Low-rise setbacks', `Road ${fmt(Math.max(2, ...r.roads.filter(Boolean).map((x) => roadSetback(x!.width))), 1)} m; sides 2 m up to 9 m high, 3 m above (below ${HIGH_RISE_M} m and 10,000 m2)`, 'BKK Ord. 2544 cl.50, 54, 55'],
      ['High-rise setbacks', `6 m from every boundary and the road (${HIGH_RISE_M} m or taller, or 10,000 m2 or more); 12 m frontage on a road >= 10 m wide`, 'MR33 cl.2, 4'],
      ['Ground buildable', `Low-rise ${fmt(a.low?.groundArea ?? 0)} m2; high-rise ${fmt(a.high?.groundArea ?? 0)} m2`, 'from the envelopes'],
    ],
    { columnStyles: { 0: { fontStyle: 'bold', cellWidth: 34 }, 2: { cellWidth: 40, textColor: MUTED } } },
  )

  // Concepts
  a.concepts.forEach((c, k) => {
    doc.addPage()
    y = M
    heading(`${3 + k}. ${c.name}`)
    para(c.tagline, 9, MUTED)
    if (c.infeasible) {
      para(c.infeasible, 10, [185, 28, 28])
      return
    }
    table(null, [[`Floor area ${fmt(c.gfa)} m2`, `FAR used ${fmt(c.gfa / r.plotArea, 2)}`, `Height ${fmt(c.height, 1)} m`, `${c.floors} floors`, r.type === 'office' ? `Footprint ${fmt(c.footprint)} m2` : `${fmt(c.units)} ${r.type === 'hotel' ? 'rooms' : 'units'}`]], {
      styles: { fontSize: 9, fontStyle: 'bold', halign: 'center', textColor: INK, fillColor: [250, 247, 242], lineColor: [225, 219, 210], lineWidth: 0.2 },
      theme: 'grid',
    })
    image(r.shots[c.id], 95)
    table(
      ['', 'Check', 'Rule', 'This design', 'Source'],
      c.checks.map((x) => [x.pass === null ? 'INFO' : x.pass ? 'PASS' : 'FAIL', x.label, x.required, x.actual, x.source]),
      {
        columnStyles: { 0: { cellWidth: 12, fontStyle: 'bold' }, 1: { cellWidth: 34, fontStyle: 'bold' }, 4: { cellWidth: 30, textColor: MUTED } },
        didParseCell: (d: { section: string; column: { index: number }; cell: { raw: unknown; styles: { textColor: unknown } } }) => {
          if (d.section === 'body' && d.column.index === 0) d.cell.styles.textColor = d.cell.raw === 'PASS' ? [4, 120, 87] : d.cell.raw === 'FAIL' ? [185, 28, 28] : MUTED
        },
      },
    )
    table(['Level', 'Use', 'Height', 'Area m2'], groupFloors(c), {
      columnStyles: { 3: { halign: 'right' } },
      foot: [
        ['Total floor area', '', `FAR ${fmt(c.gfa / r.plotArea, 2)}`, fmt(c.gfa)],
        ['Ground covered', '', '', fmt(c.footprint)],
        ['Open space', '', '', fmt(c.openSpace)],
        ['Parking required / provided', '', '', `${c.parkingRequired} / ${c.parkingProvided}`],
      ],
      footStyles: { fillColor: [250, 247, 242], textColor: INK, fontStyle: 'bold' },
    })
  })

  // Footer on every page
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(7).setTextColor(...MUTED)
    doc.text('Pre-design feasibility only, not a permit check. Rules: Bangkok Comprehensive Plan 2013, BMA Building Control Ordinance 2544, MR33, MR55.', M, H - 7)
    doc.text(`${i} / ${n}`, W - M, H - 7, { align: 'right' })
  }
  return doc
}
