import { useId } from 'react';
import { useTemplates } from '../data';
import { useExporter } from '../leads-view';
import { t } from '../plan';
import css from './Crm.module.css';

/**
 * Export (DP-1.3-05) and its layout choice (DP-1.3-26): "Omnikom CSV" first (no template: one column per field), then the workspace's saved
 * layouts by name. The choice lives in the Leads screen (the delete sheet exports with it too); this is only the control. The label sits beside
 * the select (htmlFor and id), never around it, so the select's name is "Export layout" and not that and every option.
 */
export function ExportControl({ workspaceId, template, onTemplate }: { workspaceId: string; template: string; onTemplate: (id: string) => void }) {
  const templates = useTemplates(workspaceId);
  const exporter = useExporter();
  const id = useId();
  return (
    <div className={css.export}>
      <span data-plan="DP-1.3-26" className={css.pair}>
        <label htmlFor={id}>{t('DP-1.3-26', 'Export layout')}</label>
        <select id={id} name="export-layout" value={template} onChange={e => onTemplate(e.target.value)}>
          <option value="">{t('DP-1.3-26', 'Omnikom CSV')}</option>
          {(templates.data ?? []).map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </span>
      <button type="button" data-plan="DP-1.3-05" disabled={exporter.busy || !exporter.ready} onClick={() => void exporter.run()}>{t('DP-1.3-05', 'Export')}</button>
      {exporter.message && <p data-plan="DP-1.3-05" role={exporter.failed ? 'alert' : 'status'}>{exporter.message}</p>}
    </div>
  );
}
