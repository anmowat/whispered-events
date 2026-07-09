// Airtable-style filter primitives for the admin Users tab. The page builds
// a tree of Condition / Group nodes against the catalog of FIELDS below;
// evalGroup is the runtime that decides whether a given row passes. Adding
// a new filterable field is a one-line append to FIELDS.

import { withinMiles } from './geocode'

// Row shape the admin page renders — kept here so this module and the
// page agree on field names. The dashboard-counts API response should
// mirror these keys.
export interface UserRow {
  id: string
  created: string | null
  email: string
  name: string
  firstName: string
  location: string
  frequency: string
  grade: 'A' | 'Polish' | 'B' | 'C' | null
  status: string
  isHost: boolean
  function: string
  seniority: string
  employment: string
  companySize: string
  interest: string
  linkedin: string
  learn: string
  lat: number | null
  lng: number | null
  matchCount: number
  nearbyEventCount: number
  localMatchPct: number | null
  totalContributions: number
  lastContribution: string | null
  lastSeen: string | null
  lastDigestSent: string | null
  lastBlastSent: string | null
  ratingsGoing: number
  ratingsCantMakeIt: number
  ratingsNotAFit: number
}

export type FieldType = 'text' | 'enum' | 'number' | 'date' | 'boolean' | 'geo'

export type OperatorId =
  // text
  | 'contains'
  | 'notContains'
  | 'equals'
  // enum
  | 'is'
  | 'isNot'
  // number
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  // date
  | 'before'
  | 'after'
  | 'on'
  | 'withinDays'
  | 'moreThanDaysAgo'
  // boolean
  | 'isTrue'
  | 'isFalse'
  // geo
  | 'withinMilesOf'
  // shared
  | 'isEmpty'
  | 'isNotEmpty'

export interface OperatorDef {
  id: OperatorId
  label: string
  needsValue: boolean
}

export const OPERATORS_BY_TYPE: Record<FieldType, OperatorDef[]> = {
  text: [
    { id: 'contains', label: 'contains', needsValue: true },
    { id: 'notContains', label: 'does not contain', needsValue: true },
    { id: 'equals', label: 'equals', needsValue: true },
    { id: 'isEmpty', label: 'is empty', needsValue: false },
    { id: 'isNotEmpty', label: 'is not empty', needsValue: false },
  ],
  enum: [
    { id: 'is', label: 'is', needsValue: true },
    { id: 'isNot', label: 'is not', needsValue: true },
    { id: 'isEmpty', label: 'is empty', needsValue: false },
    { id: 'isNotEmpty', label: 'is not empty', needsValue: false },
  ],
  number: [
    { id: 'eq', label: '=', needsValue: true },
    { id: 'neq', label: '≠', needsValue: true },
    { id: 'gt', label: '>', needsValue: true },
    { id: 'gte', label: '≥', needsValue: true },
    { id: 'lt', label: '<', needsValue: true },
    { id: 'lte', label: '≤', needsValue: true },
    { id: 'isEmpty', label: 'is empty', needsValue: false },
    { id: 'isNotEmpty', label: 'is not empty', needsValue: false },
  ],
  date: [
    { id: 'before', label: 'before', needsValue: true },
    { id: 'after', label: 'after', needsValue: true },
    { id: 'on', label: 'on', needsValue: true },
    { id: 'withinDays', label: 'within last N days', needsValue: true },
    { id: 'moreThanDaysAgo', label: 'more than N days ago', needsValue: true },
    { id: 'isEmpty', label: 'is empty', needsValue: false },
    { id: 'isNotEmpty', label: 'is not empty', needsValue: false },
  ],
  boolean: [
    { id: 'isTrue', label: 'is true', needsValue: false },
    { id: 'isFalse', label: 'is false', needsValue: false },
  ],
  geo: [
    { id: 'withinMilesOf', label: 'is within N miles of', needsValue: true },
  ],
}

export interface EnumOption {
  value: string
  label: string
}

export interface LatLngPair {
  lat: number | null
  lng: number | null
}

export type FieldValue = string | number | boolean | LatLngPair | null

export interface FieldDef<R> {
  id: string
  label: string
  type: FieldType
  accessor: (row: R) => FieldValue
  enumOptions?: EnumOption[]
}

// Picklist values — kept in lockstep with components/ViewEventsTab.tsx
// and the validation in the per-user PATCH route so admin choices map
// to the same canonical strings the rest of the app writes.
const FREQUENCY_OPTIONS: EnumOption[] = [
  { value: 'As they arrive', label: 'As they arrive' },
  { value: 'Weekly', label: 'Weekly' },
  { value: 'Monthly', label: 'Monthly' },
  { value: 'Paused', label: 'Paused' },
]

const GRADE_OPTIONS: EnumOption[] = [
  { value: 'A', label: 'A' },
  { value: 'Polish', label: 'Polish' },
  { value: 'B', label: 'B' },
  { value: 'C', label: 'C' },
]

const STATUS_OPTIONS: EnumOption[] = [
  { value: 'Pending', label: 'Pending' },
  { value: 'Live', label: 'Live' },
  { value: 'Passed', label: 'Passed' },
  { value: 'Deactivated', label: 'Deactivated' },
  { value: 'Partner', label: 'Partner' },
]

const EMPLOYMENT_OPTIONS: EnumOption[] = [
  { value: 'Employed', label: 'Employed' },
  { value: 'Searching', label: 'Searching' },
  { value: 'Fractional', label: 'Fractional' },
  { value: 'Other', label: 'Other' },
]

const SIZE_OPTIONS: EnumOption[] = [
  { value: '<$5M', label: '<$5M' },
  { value: '$5-25M', label: '$5-25M' },
  { value: '$25-100M', label: '$25-100M' },
  { value: '$100M-1B', label: '$100M-1B' },
  { value: '$1B+', label: '$1B+' },
  { value: 'Other', label: 'Other' },
]

export const FIELDS: FieldDef<UserRow>[] = [
  // Text
  { id: 'name', label: 'Name', type: 'text', accessor: (r) => r.name },
  { id: 'email', label: 'Email', type: 'text', accessor: (r) => r.email },
  { id: 'location', label: 'Location', type: 'text', accessor: (r) => r.location },
  { id: 'function', label: 'Function', type: 'text', accessor: (r) => r.function },
  { id: 'seniority', label: 'Seniority', type: 'text', accessor: (r) => r.seniority },
  { id: 'interest', label: 'Topics', type: 'text', accessor: (r) => r.interest },
  { id: 'linkedin', label: 'LinkedIn', type: 'text', accessor: (r) => r.linkedin },
  // Picklist
  { id: 'frequency', label: 'Frequency', type: 'enum', accessor: (r) => r.frequency, enumOptions: FREQUENCY_OPTIONS },
  { id: 'grade', label: 'Grade', type: 'enum', accessor: (r) => r.grade ?? '', enumOptions: GRADE_OPTIONS },
  { id: 'status', label: 'Status', type: 'enum', accessor: (r) => r.status, enumOptions: STATUS_OPTIONS },
  { id: 'employment', label: 'Employment', type: 'enum', accessor: (r) => r.employment, enumOptions: EMPLOYMENT_OPTIONS },
  { id: 'companySize', label: 'Size', type: 'enum', accessor: (r) => r.companySize, enumOptions: SIZE_OPTIONS },
  // Number
  { id: 'matchCount', label: 'Matches', type: 'number', accessor: (r) => r.matchCount },
  { id: 'totalContributions', label: 'Contributions', type: 'number', accessor: (r) => r.totalContributions },
  { id: 'localMatchPct', label: 'Local match %', type: 'number', accessor: (r) => r.localMatchPct },
  { id: 'nearbyEventCount', label: 'Nearby events', type: 'number', accessor: (r) => r.nearbyEventCount },
  { id: 'ratingsGoing', label: 'Going', type: 'number', accessor: (r) => r.ratingsGoing },
  { id: 'ratingsCantMakeIt', label: "Can't make it", type: 'number', accessor: (r) => r.ratingsCantMakeIt },
  { id: 'ratingsNotAFit', label: 'Not a fit', type: 'number', accessor: (r) => r.ratingsNotAFit },
  // Date
  { id: 'created', label: 'Signed up', type: 'date', accessor: (r) => r.created },
  { id: 'lastContribution', label: 'Last contribution', type: 'date', accessor: (r) => r.lastContribution },
  { id: 'lastSeen', label: 'Last seen', type: 'date', accessor: (r) => r.lastSeen },
  { id: 'lastDigestSent', label: 'Last digest sent', type: 'date', accessor: (r) => r.lastDigestSent },
  { id: 'lastBlastSent', label: 'Last blast sent', type: 'date', accessor: (r) => r.lastBlastSent },
  // Boolean
  { id: 'isHost', label: 'Is host', type: 'boolean', accessor: (r) => r.isHost },
  // Geo — accessor hands the row's coords to the predicate; the typed
  // city + radius live in the condition's value as JSON (see GeoValue).
  {
    id: 'distanceFromCity',
    label: 'Distance from city',
    type: 'geo',
    accessor: (r) => ({ lat: r.lat, lng: r.lng }),
  },
]

// Default radius shown when an admin first adds a geo condition. Freely
// editable in the row's miles input — there's no hardcoded ceiling.
export const DEFAULT_GEO_MILES = 50

export interface GeoValue {
  city: string
  lat: number | null
  lng: number | null
  miles: number
}

export function emptyGeoValue(): GeoValue {
  return { city: '', lat: null, lng: null, miles: DEFAULT_GEO_MILES }
}

export function parseGeoValue(raw: string): GeoValue {
  if (!raw) return emptyGeoValue()
  try {
    const parsed = JSON.parse(raw) as Partial<GeoValue>
    return {
      city: typeof parsed.city === 'string' ? parsed.city : '',
      lat: typeof parsed.lat === 'number' ? parsed.lat : null,
      lng: typeof parsed.lng === 'number' ? parsed.lng : null,
      miles: typeof parsed.miles === 'number' && parsed.miles > 0 ? parsed.miles : DEFAULT_GEO_MILES,
    }
  } catch {
    return emptyGeoValue()
  }
}

export function stringifyGeoValue(v: GeoValue): string {
  return JSON.stringify(v)
}

export const FIELDS_BY_ID: Record<string, FieldDef<UserRow>> = Object.fromEntries(
  FIELDS.map((f) => [f.id, f]),
)

// Node tree --------------------------------------------------------------

export type Conjunction = 'AND' | 'OR'

export interface Condition {
  kind: 'condition'
  id: string
  fieldId: string
  operator: OperatorId
  value: string
}

export interface Group {
  kind: 'group'
  id: string
  conjunction: Conjunction
  children: Node[]
}

export type Node = Condition | Group

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `n_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`
}

export function newCondition(): Condition {
  // Default to the first field with a value-needing operator so the row
  // starts in a useful shape (Name / contains / "").
  const field = FIELDS[0]
  const op = OPERATORS_BY_TYPE[field.type].find((o) => o.needsValue) ?? OPERATORS_BY_TYPE[field.type][0]
  return {
    kind: 'condition',
    id: makeId(),
    fieldId: field.id,
    operator: op.id,
    value: '',
  }
}

export function newGroup(conjunction: Conjunction = 'AND'): Group {
  return { kind: 'group', id: makeId(), conjunction, children: [] }
}

export function emptyRoot(): Group {
  return newGroup('AND')
}

// Count of leaf conditions anywhere in the tree. Drives the "filters
// active" badge in the page header.
export function countConditions(node: Node): number {
  if (node.kind === 'condition') return 1
  return node.children.reduce((n, c) => n + countConditions(c), 0)
}

// Immutable tree updaters — return a new root with the node replaced
// or removed. The id-based lookup keeps the call sites in the UI from
// having to thread setters all the way down to nested rows.
export function cloneAndReplace(root: Group, nodeId: string, replacement: Node): Group {
  return replaceIn(root, nodeId, replacement) as Group
}

function replaceIn(node: Node, nodeId: string, replacement: Node): Node {
  if (node.id === nodeId) return replacement
  if (node.kind === 'group') {
    return { ...node, children: node.children.map((c) => replaceIn(c, nodeId, replacement)) }
  }
  return node
}

export function cloneAndRemove(root: Group, nodeId: string): Group {
  return removeIn(root, nodeId) as Group
}

function removeIn(node: Node, nodeId: string): Node {
  if (node.kind !== 'group') return node
  return {
    ...node,
    children: node.children
      .filter((c) => c.id !== nodeId)
      .map((c) => removeIn(c, nodeId)),
  }
}

export function cloneAndAppend(root: Group, parentId: string, child: Node): Group {
  return appendIn(root, parentId, child) as Group
}

function appendIn(node: Node, parentId: string, child: Node): Node {
  if (node.kind !== 'group') return node
  if (node.id === parentId) {
    return { ...node, children: [...node.children, child] }
  }
  return { ...node, children: node.children.map((c) => appendIn(c, parentId, child)) }
}

// Evaluation -------------------------------------------------------------

// `true` is the fail-open default: stale fieldId, unknown operator,
// half-typed condition (e.g. number ≥ blank) → row passes. Stops a
// mid-edit condition from blanking the table.
export function evalCondition<R>(row: R, cond: Condition, fields: Record<string, FieldDef<R>>): boolean {
  const field = fields[cond.fieldId]
  if (!field) return true
  const rawValue = field.accessor(row)

  switch (cond.operator) {
    case 'isEmpty':
      return isEmptyValue(rawValue)
    case 'isNotEmpty':
      return !isEmptyValue(rawValue)
    case 'isTrue':
      return rawValue === true
    case 'isFalse':
      return rawValue === false || rawValue === null
  }

  if (field.type === 'text' || field.type === 'enum') {
    const v = stringify(rawValue).toLowerCase()
    const cv = cond.value.toLowerCase()
    switch (cond.operator) {
      case 'contains':
        return v.includes(cv)
      case 'notContains':
        // Empty fields pass — "does not contain X" matches blank rows.
        return !v.includes(cv)
      case 'equals':
      case 'is':
        return v === cv
      case 'isNot':
        return v !== cv
    }
    return true
  }

  if (field.type === 'number') {
    if (cond.value.trim() === '') return true
    const target = Number(cond.value)
    if (!Number.isFinite(target)) return true
    if (rawValue === null || rawValue === undefined) return false
    const n = Number(rawValue)
    if (!Number.isFinite(n)) return false
    switch (cond.operator) {
      case 'eq': return n === target
      case 'neq': return n !== target
      case 'gt': return n > target
      case 'gte': return n >= target
      case 'lt': return n < target
      case 'lte': return n <= target
    }
    return true
  }

  if (field.type === 'date') {
    if (cond.value.trim() === '') return true
    if (rawValue === null || rawValue === undefined || rawValue === '') return false
    const rowTs = Date.parse(String(rawValue))
    if (!Number.isFinite(rowTs)) return false

    switch (cond.operator) {
      case 'before': {
        const dayStart = startOfLocalDay(cond.value)
        if (dayStart === null) return true
        return rowTs < dayStart
      }
      case 'after': {
        const dayEnd = endOfLocalDay(cond.value)
        if (dayEnd === null) return true
        return rowTs > dayEnd
      }
      case 'on': {
        const dayStart = startOfLocalDay(cond.value)
        const dayEnd = endOfLocalDay(cond.value)
        if (dayStart === null || dayEnd === null) return true
        return rowTs >= dayStart && rowTs <= dayEnd
      }
      case 'withinDays': {
        const days = Number(cond.value)
        if (!Number.isFinite(days) || days < 0) return true
        return rowTs >= Date.now() - days * 86_400_000
      }
      case 'moreThanDaysAgo': {
        const days = Number(cond.value)
        if (!Number.isFinite(days) || days < 0) return true
        return rowTs < Date.now() - days * 86_400_000
      }
    }
    return true
  }

  if (field.type === 'geo') {
    if (cond.operator !== 'withinMilesOf') return true
    const geo = parseGeoValue(cond.value)
    // Half-typed: no city yet, unresolved, or non-positive radius → fail
    // open so the table doesn't blank while the admin is mid-edit.
    if (!geo.city.trim()) return true
    if (geo.lat === null || geo.lng === null) return true
    if (!Number.isFinite(geo.miles) || geo.miles <= 0) return true
    // User row with no coords → exclude. Matches how the matching
    // pipeline treats no-geocode users.
    if (!isLatLngPair(rawValue)) return false
    if (rawValue.lat === null || rawValue.lng === null) return false
    return withinMiles(
      { lat: rawValue.lat, lng: rawValue.lng },
      { lat: geo.lat, lng: geo.lng },
      geo.miles,
    )
  }

  return true
}

export function evalGroup<R>(row: R, group: Group, fields: Record<string, FieldDef<R>>): boolean {
  if (group.children.length === 0) return true
  if (group.conjunction === 'AND') {
    return group.children.every((c) => evalNode(row, c, fields))
  }
  return group.children.some((c) => evalNode(row, c, fields))
}

function evalNode<R>(row: R, node: Node, fields: Record<string, FieldDef<R>>): boolean {
  if (node.kind === 'condition') return evalCondition(row, node, fields)
  return evalGroup(row, node, fields)
}

// Helpers ----------------------------------------------------------------

function isLatLngPair(v: FieldValue): v is LatLngPair {
  return typeof v === 'object' && v !== null && 'lat' in v && 'lng' in v
}

function isEmptyValue(v: FieldValue): boolean {
  if (v === null || v === undefined) return true
  if (isLatLngPair(v)) return v.lat === null || v.lng === null
  if (typeof v === 'string') return v.trim() === ''
  if (typeof v === 'number') return !Number.isFinite(v)
  return false
}

function stringify(v: FieldValue): string {
  if (v === null || v === undefined) return ''
  if (isLatLngPair(v)) return ''
  return String(v)
}

// YYYY-MM-DD from a date <input> → local-time start-of-day timestamp.
// Date.parse on a bare YYYY-MM-DD treats it as UTC; we want local so
// "before 2026-06-01" excludes rows from May 31 PT, not June 1 PT.
function startOfLocalDay(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim())
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0)
  const t = d.getTime()
  return Number.isFinite(t) ? t : null
}

function endOfLocalDay(ymd: string): number | null {
  const start = startOfLocalDay(ymd)
  if (start === null) return null
  return start + 86_400_000 - 1
}
