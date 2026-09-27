import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, Text, useInput } from 'ink';
import wrapAnsi from 'wrap-ansi';
import stringWidth from 'string-width';
import type { FullCard, EnrichedCard } from '../../src/shared/model';
import { STATUS_ACTIVE_VALUES, PRIORITY_ALL_VALUES } from '../../src/filterUniverse';
import type { BrowserController } from './controller';
import type { DisplayRow, Filters } from './contracts';
import { safeText, fitText } from './text';
import { copyId } from './clipboard';

export interface AppProps {
  controller: BrowserController;
  repo: string;
  version: string;
  clipboard: 'auto' | 'osc52' | 'manual';
  onExit: () => void;
  width?: number;
  height?: number;
}

const groups = ['statuses', 'priorities', 'types'] as const;
const labels = ['Status', 'Priority', 'Type'];
const minimumWidth = 100;
const minimumHeight = 24;
const columnWidth = 28;
const ownValue = <T,>(values: Record<string, T>, key: string): T | undefined =>
  Object.hasOwn(values, key) ? values[key] : undefined;
const statusLabels: Record<string, string> = { open: 'Open', in_progress: 'In Progress', blocked: 'Blocked',
  deferred: 'Deferred', closed: 'Closed' };
const statusLabel = (status: string): string => ownValue(statusLabels, status) ?? safeText(status);
const windowOffset = (offset: number, selected: number, count: number, size: number): number => {
  let next = Math.max(0, Math.min(offset, Math.max(0, count - size)));
  if (selected >= 0 && selected < next) { next = selected; }
  if (selected >= next + size) { next = selected - size + 1; }
  return next;
};
const pad = (text: unknown, width: number): string => {
  const fitted = fitText(text, width);
  return fitted + ' '.repeat(Math.max(0, width - stringWidth(fitted)));
};

function treeText(row: DisplayRow, width: number): React.JSX.Element {
  const guide = row.depth ? row.guides.map(continues => continues ? '│ ' : '  ').join('') + (row.isLast ? '└─' : '├─') : '';
  const branch = row.hasChildren ? (row.expanded ? '▾ ' : '▸ ') : '  ';
  const card = row.card;
  const priority = `[${fitText(`P${card.priority}`, 5)}]`;
  const type = `[${fitText(card.issue_type, Math.min(16, Math.floor(width / 4)))}]`;
  const suffix = `${row.parentNotLoaded ? ' [parent not loaded]' : ''} ${fitText(card.status, 12)} `;
  const badgesWidth = stringWidth(priority + ' ' + type);
  const textWidth = Math.max(0, width - badgesWidth - 1);
  const prefix = fitText(`${guide}${branch}${safeText(card.id)} `, Math.max(8, textWidth - stringWidth(suffix) - 5));
  const text = fitText(`${prefix} ${fitText(card.title, Math.max(1, textWidth - stringWidth(prefix) - stringWidth(suffix) - 1))}${suffix}`, textWidth);
  const colors = ['red', 'yellow', 'green', 'blue', 'gray'] as const;
  return <Text>{text} <Text bold color={colors[card.priority] ?? 'gray'}>{priority}</Text> <Text bold color="cyan">{type}</Text></Text>;
}

function tableText(card: EnrichedCard | null, width: number): string {
  const assignee = width >= 85;
  const idWidth = Math.min(20, Math.floor(width / 4));
  const titleWidth = width - idWidth - 13 - 4 - 12 - (assignee ? 13 : 0);
  return pad(card?.id ?? 'ID', idWidth) + pad(card?.title ?? 'Title', titleWidth)
    + pad(card?.status ?? 'Status', 13) + pad(card ? `P${card.priority}` : 'Pri', 4)
    + pad(card?.issue_type ?? 'Type', 12) + (assignee ? pad(card?.assignee ?? (card ? '—' : 'Assignee'), 13) : '');
}

function detailLines(card: FullCard | null, width: number): string[] {
  if (!card) { return []; }
  const fields: [string, unknown][] = [
    ['ID', card.id], ['Title', card.title], ['Status', card.status], ['Priority', card.priority], ['Type', card.issue_type],
    ['Description', card.description], ['Acceptance criteria', card.acceptance_criteria], ['Design', card.design], ['Notes', card.notes],
    ['Labels', card.labels?.join(', ')], ['Assignee', card.assignee], ['Created', card.created_at], ['Created by', card.created_by],
    ['Updated', card.updated_at], ['Closed', card.closed_at], ['Close reason', card.close_reason], ['Due', card.due_at],
    ['Deferred until', card.defer_until], ['External reference', card.external_ref],
    ['Parent', card.parent ? `${safeText(card.parent.id)} ${safeText(card.parent.title)}` : undefined],
  ];
  for (const [label, references] of [['Children', card.children], ['Blocks', card.blocks], ['Blocked by', card.blocked_by]] as const) {
    if (references?.length) { fields.push([label, references.map(ref => `${safeText(ref.id)} ${safeText(ref.title)}`).join('\n')]); }
  }
  for (const comment of card.comments ?? []) {
    fields.push([`Comment ${safeText(comment.author)} · ${safeText(comment.created_at)}`, comment.text]);
  }
  return fields.filter(([, value]) => value !== undefined && value !== null && value !== '')
    .flatMap(([label, value]) => wrapAnsi(`${safeText(label)}: ${safeText(value)}`, width, { hard: true, trim: false }).split('\n'));
}

export function App({ controller, repo, version, clipboard, onExit, width, height }: AppProps): React.JSX.Element {
  const state = useSyncExternalStore(listener => controller.subscribe(listener), () => controller.getState());
  const projection = controller.project();
  const [terminal, setTerminal] = useState({ width: process.stdout.columns || 100, height: process.stdout.rows || 24 });
  const [focus, setFocus] = useState<'main' | 'details'>('main');
  const [mode, setMode] = useState<'navigation' | 'search' | 'filters' | 'help'>('navigation');
  const [group, setGroup] = useState(0);
  const [filterIndex, setFilterIndex] = useState(0);
  const [detailOffset, setDetailOffset] = useState(0);
  const [notice, setNotice] = useState<{ text: string; request: number } | null>(null);
  const copyRequest = useRef(0);
  const [clipboardLifetime] = useState(() => new AbortController());
  const exit = (): void => { clipboardLifetime.abort(); onExit(); };
  const columns = Math.max(1, Math.floor(width ?? terminal.width));
  const rows = Math.max(1, Math.floor(height ?? terminal.height));
  const narrow = columns < minimumWidth || rows < minimumHeight;
  const mainWidth = Math.floor(columns * 0.6);
  const mainInner = mainWidth - 2;
  const detailsWidth = columns - mainWidth;
  const bodyHeight = Math.max(1, rows - 7);
  const capacity = Math.max(1, bodyHeight - 3);
  const rowCapacity = Math.max(1, capacity - (state.view === 'table' ? 1 : 0));
  const cardCapacity = Math.max(1, Math.floor((capacity - 1) / 3));
  const columnCapacity = Math.max(1, Math.floor((mainInner + 1) / (columnWidth + 1)));
  const activeColumn = projection.columns[state.kanbanColumn];
  const flat = state.view === 'tree' ? projection.rows.map(row => row.card) : projection.matching;
  const flatOffset = windowOffset(state.viewports[state.view], flat.findIndex(card => card.id === state.selectedId), flat.length, rowCapacity);
  const columnStart = windowOffset(state.viewports.kanban, state.kanbanColumn, projection.columns.length, columnCapacity);
  const cardOffset = (index: number): number => {
    const column = projection.columns[index];
    return windowOffset(ownValue(state.columnOffsets, column.status) ?? 0,
      index === state.kanbanColumn ? column.cards.findIndex(card => card.id === state.selectedId) : -1, column.cards.length, cardCapacity);
  };
  const shownColumns = projection.columns.slice(columnStart, columnStart + columnCapacity);
  const columnSpace = mainInner - Math.max(0, shownColumns.length - 1);
  const allocatedWidth = (index: number): number => Math.floor(columnSpace / shownColumns.length)
    + (index < columnSpace % shownColumns.length ? 1 : 0);
  const visibleCount = mode === 'filters' || mode === 'help' ? 0 : state.view === 'kanban'
    ? shownColumns.reduce((count, column, index) => count + column.cards.slice(cardOffset(columnStart + index), cardOffset(columnStart + index) + cardCapacity).length, 0)
    : flat.slice(flatOffset, flatOffset + rowCapacity).length;
  const details = useMemo(() => detailLines(state.detail, Math.max(1, detailsWidth - 2)), [state.detail, detailsWidth]);
  const detailStart = Math.min(detailOffset, Math.max(0, details.length - capacity));
  const choices = group === 0 ? projection.statuses : group === 1 ? [...PRIORITY_ALL_VALUES] : projection.types;
  const selectedFilters = state.filters[groups[group]];

  useEffect(() => {
    const resize = (): void => setTerminal({ width: process.stdout.columns || 100, height: process.stdout.rows || 24 });
    process.stdout.on('resize', resize);
    return () => { process.stdout.off('resize', resize); };
  }, []);
  useEffect(() => { setDetailOffset(0); }, [state.selectedId]);
  useEffect(() => () => clipboardLifetime.abort(), [clipboardLifetime]);
  useEffect(() => {
    if (!notice) { return; }
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (narrow) { return; }
    if (state.view === 'kanban') {
      if (columnStart !== state.viewports.kanban) { controller.setViewport('kanban', columnStart); }
      shownColumns.forEach((column, index) => {
        const offset = cardOffset(columnStart + index);
        if (offset !== (ownValue(state.columnOffsets, column.status) ?? 0)) { controller.setColumnOffset(column.status, offset); }
      });
    } else if (flatOffset !== state.viewports[state.view]) { controller.setViewport(state.view, flatOffset); }
  });

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { exit(); return; }
    if (narrow) { if (input === 'q') { exit(); } return; }
    if (mode === 'search') {
      if (key.escape || key.return) { setMode('navigation'); }
      else if (key.backspace || key.delete) {
        const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(state.filters.search)];
        controller.setFilters({ search: parts.slice(0, -1).map(part => part.segment).join('') });
      } else if (!key.ctrl && !key.meta && !key.upArrow && !key.downArrow && !key.leftArrow && !key.rightArrow && !key.tab && !key.pageUp && !key.pageDown) {
        controller.setFilters({ search: state.filters.search + safeText(input).replace(/\n/gu, '') });
      }
      return;
    }
    if (mode === 'help') { if (key.escape || input === '?' || key.return) { setMode('navigation'); } return; }
    if (mode === 'filters') {
      if (key.escape || key.return) { setMode('navigation'); return; }
      if (key.tab || key.rightArrow || key.leftArrow) {
        setGroup((group + (key.leftArrow || key.shift ? 2 : 1)) % 3); setFilterIndex(0); return;
      }
      if (key.downArrow || input === 'j') { setFilterIndex(Math.min(choices.length - 1, filterIndex + 1)); }
      else if (key.upArrow || input === 'k') { setFilterIndex(Math.max(0, filterIndex - 1)); }
      else if (input === 'r') { controller.resetFilters(); }
      else {
        let values: string[] | undefined;
        if (input === 'a') { values = [...choices]; }
        if (input === 'n') { values = []; }
        if (input === 's') { values = group === 0 ? [...STATUS_ACTIVE_VALUES] : [...choices]; }
        if (input === ' ' && choices[filterIndex] !== undefined) {
          const value = choices[filterIndex];
          values = selectedFilters.includes(value) ? selectedFilters.filter(item => item !== value) : [...selectedFilters, value];
        }
        if (values) { controller.setFilters({ [groups[group]]: values } as Partial<Filters>); }
      }
      return;
    }
    if (input === 'q') { exit(); }
    else if (input === 'v') { controller.cycleView(); }
    else if (input === '/') { setMode('search'); }
    else if (input === 'f') { setMode('filters'); }
    else if (input === '?') { setMode('help'); }
    else if (input === 'r') { void controller.refresh(); }
    else if (input === 'y' && state.selectedId) {
      const request = ++copyRequest.current;
      const showNotice = (text: string): void => {
        if (request === copyRequest.current && !clipboardLifetime.signal.aborted) { setNotice({ text, request }); }
      };
      void copyId(state.selectedId, clipboard, { signal: clipboardLifetime.signal }).then(showNotice, error => showNotice(safeText(error)));
    } else if (key.tab) { setFocus(focus === 'main' ? 'details' : 'main'); }
    else if (key.upArrow || key.downArrow || input === 'j' || input === 'k' || key.pageUp || key.pageDown) {
      const direction = key.upArrow || input === 'k' || key.pageUp ? -1 : 1;
      const amount = key.pageUp || key.pageDown ? (focus === 'details' ? capacity : state.view === 'kanban' ? cardCapacity : rowCapacity) : 1;
      if (focus === 'details') { setDetailOffset(Math.max(0, Math.min(Math.max(0, details.length - capacity), detailStart + direction * amount))); }
      else { controller.move(direction * amount); }
    } else if (focus === 'main') {
      if (key.leftArrow) { controller.horizontal(-1); }
      else if (key.rightArrow) { controller.horizontal(1); }
      else if (input === ' ') { controller.toggle(); }
    }
  });

  if (narrow) {
    return <Box width={columns} flexDirection="column"><Text>{fitText('Resize terminal: minimum 100×24 for Tree, Table and Kanban.', columns)}</Text>
      <Text>{fitText(`Current ${columns}×${rows}. q / Ctrl-C exit.`, columns)}</Text></Box>;
  }
  const filterStart = Math.max(0, filterIndex - capacity + 5);
  return <Box width={columns} height={rows} flexDirection="column">
    <Text bold>{fitText(`Beads · ${safeText(version)} · ${safeText(repo)}`, columns)}</Text>
    <Text>{['tree', 'table', 'kanban'].map(view => <Text key={view} inverse={state.view === view} bold={state.view === view} color={state.view === view ? 'cyan' : undefined}>{` ${state.view === view ? view.toUpperCase() : view} `}</Text>)}{'  '}<Text bold color="yellow">{`Focus: ${focus.toUpperCase()}`}</Text><Text dimColor>{'  v cycle · Tab focus · ? help'}</Text></Text>
    <Text>{fitText(`${visibleCount} visible · ${projection.matching.length} matching / ${state.cards.length} loaded · ${state.loading ? 'Refreshing…' : state.stale ? 'STALE' : 'Snapshot'} · Refreshed ${state.lastRefresh ? new Date(state.lastRefresh).toISOString() : 'never'}`, columns)}</Text>
    <Text color={state.truncated || state.stale ? 'yellow' : undefined}>{fitText(state.truncated
      ? `PARTIAL: filters/counts cover loaded issues only.${state.view === 'tree' ? ' Hierarchy context may be incomplete.' : ''}`
      : state.stale ? `STALE: ${safeText(state.error)}` : 'Counts cover the loaded snapshot; Kanban groups by stored status.', columns)}</Text>
    <Box height={bodyHeight} flexDirection="row">
      <Box width={mainWidth} height={bodyHeight} borderStyle="single" borderColor={focus === 'main' ? 'cyan' : undefined} flexDirection="column">
        <Text bold>{fitText(mode === 'filters' ? 'Filters' : mode === 'help' ? 'Help' : `${state.view.toUpperCase()}${state.view === 'kanban' ? ` · columns ${columnStart + 1}–${Math.min(projection.columns.length, columnStart + columnCapacity)}/${projection.columns.length}` : ''}`, mainInner)}</Text>
        {mode === 'help' ? <Text>{[
          'v Tree → Table → Kanban', '↑/↓ j/k select · ←/→ tree/columns', 'Space toggle tree · Tab main/details', 'PageUp/PageDown scroll focused pane', '/ search · Esc/Enter finish editing', 'f filters · Tab/←/→ choose group', 'Space toggle · a All · n None', 's Active (status); All (priority/type)', 'r reset filters inside filter dialog', 'r refresh · y copy ID · q/Ctrl-C exit', 'Minimum split-pane size: 100×24', 'Kanban columns use stored status.',
        ].slice(0, capacity).map(line => fitText(line, mainInner)).join('\n')}</Text>
          : mode === 'filters' ? <>
            <Text>{fitText(labels.map((label, index) => index === group ? `[${label}]` : label).join(' · '), mainInner)}</Text>
            <Text>{fitText('Tab/←/→ group · ↑/↓ choose · Space toggle', mainInner)}</Text>
            <Text>{fitText('s Active · a All · n None · r reset · Esc done', mainInner)}</Text>
            {choices.slice(filterStart, filterStart + Math.max(1, capacity - 4)).map((value, index) => <Text key={value} inverse={filterStart + index === filterIndex}>{fitText(`${selectedFilters.includes(value) ? '[x]' : '[ ]'} ${safeText(value)}`, mainInner)}</Text>)}
          </> : state.view === 'kanban' ? <Box flexDirection="row">
            {shownColumns.map((column, index) => {
              const start = cardOffset(columnStart + index);
              const width = allocatedWidth(index);
              return <Box key={column.status} width={width} marginRight={index < shownColumns.length - 1 ? 1 : 0} flexShrink={0} flexDirection="column">
                <Text bold color={columnStart + index === state.kanbanColumn ? 'cyan' : undefined}>{fitText(`${statusLabel(column.status)} (${column.cards.length})`, width)}</Text>
                {column.cards.length === 0 ? <Text dimColor>{fitText(' No matching cards', width)}</Text> : column.cards.slice(start, start + cardCapacity).map(card => <Box key={card.id} flexDirection="column">
                  <Text inverse={card.id === state.selectedId}>{fitText(`${card.id === state.selectedId ? '●' : ' '} ${safeText(card.id)} P${card.priority}`, width)}</Text>
                  <Text>{fitText(card.title, width)}</Text>
                  <Text dimColor>{fitText(card.issue_type, width)}</Text>
                </Box>)}
              </Box>;
            })}
          </Box> : <>
            {state.view === 'table' && <Text bold>{tableText(null, mainInner - 2)}</Text>}
            {flat.length === 0 ? <Text>No matching issues</Text> : flat.slice(flatOffset, flatOffset + rowCapacity).map((card, index) => <Text key={card.id} inverse={card.id === state.selectedId} dimColor={state.view === 'tree' && !projection.rows[flatOffset + index].matches}>
              {card.id === state.selectedId ? '● ' : '  '}{state.view === 'tree' ? treeText(projection.rows[flatOffset + index], mainInner - 2) : tableText(card, mainInner - 2)}
            </Text>)}
          </>}
      </Box>
      <Box width={detailsWidth} height={bodyHeight} borderStyle="single" borderColor={focus === 'details' ? 'cyan' : undefined} flexDirection="column">
        <Text bold>{fitText(`Details ${details.length ? `${detailStart + 1}–${Math.min(details.length, detailStart + capacity)}/${details.length}` : ''}`, detailsWidth - 2)}</Text>
        {state.detailLoading ? <Text>Loading details…</Text> : state.detailError ? <Text color="red">{fitText(state.detailError, detailsWidth - 2)}</Text>
          : !state.selectedId ? <Text>No selection</Text> : <Text>{details.slice(detailStart, detailStart + capacity).join('\n')}</Text>}
      </Box>
    </Box>
    <Text>{fitText(`${mode === 'search' ? 'Search (Esc/Enter finish)' : 'Search'}: ${safeText(state.filters.search)}${mode === 'search' ? '▏' : ''}`, columns)}</Text>
    <Text color={state.error ? 'yellow' : undefined}>{fitText(notice?.text || (state.error ? `STALE: ${safeText(state.error)}` : state.view === 'kanban' && !activeColumn?.cards.length ? 'Empty column: no selection. ←/→ choose a column.' : 'j/k move · / search · f filters · r refresh · y copy · q exit'), columns)}</Text>
    <Text dimColor>{fitText('Read-only · Details: Tab then ↑/↓ or PageUp/PageDown', columns)}</Text>
  </Box>;
}
