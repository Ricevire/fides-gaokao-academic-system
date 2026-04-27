export type HtmlFragment = string;

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function renderTable(headers: string[], rows: HtmlFragment[], emptyText = 'No data'): HtmlFragment {
  if (!rows.length) return `<div class="empty">${escapeHtml(emptyText)}</div>`;
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

export function renderTag(value: unknown, tone: 'default' | 'green' | 'orange' = 'default'): HtmlFragment {
  return `<span class="tag ${tone === 'default' ? '' : tone}">${escapeHtml(value)}</span>`;
}

export function renderButton(
  label: string,
  {
    id,
    variant = '',
    type = 'button',
    disabled = false,
    data = {}
  }: {
    id?: string;
    variant?: string;
    type?: 'button' | 'submit' | 'reset';
    disabled?: boolean;
    data?: Record<string, string | number | boolean | null | undefined>;
  } = {}
): HtmlFragment {
  const dataAttrs = Object.entries(data)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `data-${name}="${escapeHtml(value)}"`)
    .join(' ');
  return `<button ${id ? `id="${escapeHtml(id)}"` : ''} class="btn ${escapeHtml(variant)}" type="${type}" ${disabled ? 'disabled' : ''} ${dataAttrs}>${escapeHtml(label)}</button>`;
}
