import { useId, useState, type DragEvent, type ReactNode } from 'react';
import { putFile, uploadFinish, uploadStart } from '../api';
import { useMedia, useSignedUrl, type ContentRow } from '../data';
import { fieldLabel, humanize, pathKey, SEO_DESCRIPTION_MAX, SEO_DESCRIPTION_MIN, SEO_TITLE_MAX, SEO_TITLE_MIN, seoShort, type Contract, type FieldDef, type Path } from '../lib/site';
import { CallFailed } from '../lib/problems';
import { t } from '../plan';

/**
 * One widget per contract field type (03-FRONTEND B4, DP-1.4-09 to -13, -16). Every widget is a plain label and input: the Design department
 * styles them later. A name the plan has no sentence for (a money's currency, an address's city) is the stored key itself, opened up.
 */
export type FieldError = { msg: string; code?: string };
export type WidgetCtx = {
  workspaceId: string;
  contract: Contract;
  rows: ContentRow[];
  errors: ReadonlyMap<string, FieldError>;
  /** The mail address behind "Ask us" (DP-1.4-15); the plan gives none, so it comes from the build's configuration. */
  askEmail: string;
  /** The page this item is, for the search card's address line. */
  pagePath: string;
  host: string;
  /** A slug is locked once its row has been published. */
  slugLocked: boolean;
};
type Props = { name: string; def: FieldDef; path: Path; value: unknown; onChange: (path: Path, value: unknown) => void; ctx: WidgetCtx };

const JPG_PNG_WEBP = ['image/jpeg', 'image/png', 'image/webp'];
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function Errors({ path, ctx }: { path: Path; ctx: WidgetCtx }) {
  const e = ctx.errors.get(pathKey(path));
  if (!e) return null;
  return (
    <p role="alert" data-plan="DP-1.4-13">
      {e.msg}
      {e.code && <><br /><small>{e.code}</small></>}
    </p>
  );
}

/** "n of max" with the red mark past the limit (DP-1.4-09), and the plan's "is too long" sentence under the field; under the minimum, the plan's "needs at least" hint (Save stays on). */
function Counter({ n, max, label, short, min }: { n: number; max: number; label: string; short?: boolean; min?: number }) {
  const over = n > max;
  return (
    <>
      <span data-plan="DP-1.4-09" data-over={over ? 'true' : 'false'}>{n} of {max}</span>
      {over && <small role="alert" data-plan="DP-1.4-09">{label} is too long</small>}
      {short && <small data-plan="DP-1.4-09" data-under="true">{label} needs at least {min} characters to publish</small>}
    </>
  );
}

/** A locked field (DP-1.4-15, DP-1.4-07): greyed, its reason from the contract, the plan's sentence and the "Ask us" link. */
function Locked({ name, def, value, ctx }: Pick<Props, 'name' | 'def' | 'value' | 'ctx'>) {
  const id = useId();
  const text = typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value);
  return (
    <div data-plan="DP-1.4-15" data-locked="true">
      <label htmlFor={id}>{fieldLabel(name, def)}</label>
      <textarea id={id} readOnly disabled value={text} />
      {def.locked?.reason && <p data-plan="DP-1.4-07">{def.locked.reason}</p>}
      <AskUs email={ctx.askEmail} />
    </div>
  );
}

/** "Omnikom changes this after sign-off. Ask us." (DP-1.4-15): Ask us is a mail link when the build knows the address. */
export function AskUs({ email }: { email: string }) {
  return (
    <p data-plan="DP-1.4-15">
      Omnikom changes this after sign-off. {email ? <a href={`mailto:${email}`}>Ask us</a> : 'Ask us'}.
    </p>
  );
}

export function FieldWidget(props: Props): ReactNode {
  const { name, def, path, value, onChange, ctx } = props;
  if (def.internal || def.type === 'sections') return null;
  if (def.locked) return <Locked name={name} def={def} value={value} ctx={ctx} />;
  if (def.sourced) return <Sourced {...props} />;
  switch (def.type) {
    case 'text': case 'richtext': case 'slug': case 'email': case 'phone': case 'url': return <TextWidget {...props} />;
    case 'number': return <NumberWidget {...props} />;
    case 'money': return <MoneyWidget {...props} />;
    case 'boolean': return <BooleanWidget {...props} />;
    case 'date': case 'datetime': return <DateWidget {...props} />;
    case 'enum': return <EnumWidget {...props} />;
    case 'reference': return <ReferenceWidget {...props} />;
    case 'address': return <AddressWidget {...props} />;
    case 'geo': return <GeoWidget {...props} />;
    case 'group': return def.of ? <GroupWidget {...props} /> : null;
    case 'list': return def.of ? <ListWidget {...props} /> : null;
    case 'image': return <PhotoSlot label={fieldLabel(name, def)} def={def} path={path} value={value} onChange={onChange} ctx={ctx} />;
    case 'gallery': return <GalleryWidget {...props} />;
    case 'seo': return <SeoWidget {...props} />;
    default: return null;
  }
}

function TextWidget({ name, def, path, value, onChange, ctx }: Props) {
  const id = useId();
  const label = fieldLabel(name, def);
  const v = str(value);
  const long = def.type === 'richtext';
  const set = (s: string) => onChange(path, s === '' ? undefined : s);
  const locked = def.type === 'slug' && ctx.slugLocked;
  const type = def.type === 'email' ? 'email' : def.type === 'phone' ? 'tel' : def.type === 'url' ? 'url' : 'text';
  const counter = typeof def.max === 'number' && (def.type === 'text' || def.type === 'richtext') ? <Counter n={v.length} max={def.max} label={label} /> : null;
  // long text is DP-1.4-10, a single line of text DP-1.4-09, the rest of the one-line types DP-1.4-13
  if (long) {
    return (
      <div data-plan="DP-1.4-10" data-path={pathKey(path)}>
        <label htmlFor={id}>{label}</label>
        <textarea id={id} value={v} disabled={locked} onChange={e => set(e.target.value)} />
        {counter}
        <Errors path={path} ctx={ctx} />
      </div>
    );
  }
  if (def.type === 'text') {
    return (
      <div data-plan="DP-1.4-09" data-path={pathKey(path)}>
        <label htmlFor={id}>{label}</label>
        <input id={id} type={type} value={v} disabled={locked} onChange={e => set(e.target.value)} />
        {counter}
        <Errors path={path} ctx={ctx} />
      </div>
    );
  }
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} value={v} disabled={locked} onChange={e => set(e.target.value)} />
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function NumberWidget({ name, def, path, value, onChange, ctx }: Props) {
  const id = useId();
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <label htmlFor={id}>{fieldLabel(name, def)}</label>
      <input id={id} type="number" step={def.integer ? 1 : 'any'} min={def.min} max={def.max} value={typeof value === 'number' ? value : ''} onChange={e => onChange(path, e.target.value === '' ? undefined : Number(e.target.value))} />
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function MoneyWidget({ name, def, path, value, onChange, ctx }: Props) {
  const id = useId();
  const m = obj(value);
  const put = (amount: unknown, currency: unknown) => onChange(path, amount === undefined && !currency ? undefined : { amount, currency: currency || 'USD' });
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <label htmlFor={id}>{fieldLabel(name, def)}</label>
      <input id={id} type="number" min={0} step="any" value={typeof m.amount === 'number' ? m.amount : ''} onChange={e => put(e.target.value === '' ? undefined : Number(e.target.value), m.currency)} />
      <input aria-label={humanize('currency')} type="text" maxLength={3} value={str(m.currency)} onChange={e => put(m.amount, e.target.value.toUpperCase())} />
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function BooleanWidget({ name, def, path, value, onChange, ctx }: Props) {
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <label><input type="checkbox" checked={value === true} onChange={e => onChange(path, e.target.checked ? true : undefined)} /> {fieldLabel(name, def)}</label>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function DateWidget({ name, def, path, value, onChange, ctx }: Props) {
  const id = useId();
  const time = def.type === 'datetime';
  const raw = str(value);
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <label htmlFor={id}>{fieldLabel(name, def)}</label>
      <input id={id} type={time ? 'datetime-local' : 'date'} value={time ? raw.slice(0, 16) : raw} onChange={e => onChange(path, e.target.value === '' ? undefined : e.target.value)} />
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function EnumWidget({ name, def, path, value, onChange, ctx }: Props) {
  const id = useId();
  const options = def.options ?? [];
  const label = fieldLabel(name, def);
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      {options.length <= 4 ? (
        <fieldset role="radiogroup" aria-label={label}>
          <legend>{label}</legend>
          {options.map(o => (
            <label key={o}><input type="radio" name={id} value={o} checked={value === o} onChange={() => onChange(path, o)} /> {humanize(o)}</label>
          ))}
        </fieldset>
      ) : (
        <>
          <label htmlFor={id}>{label}</label>
          <select id={id} value={str(value)} onChange={e => onChange(path, e.target.value === '' ? undefined : e.target.value)}>
            <option value="" />
            {options.map(o => <option key={o} value={o}>{humanize(o)}</option>)}
          </select>
        </>
      )}
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function ReferenceWidget({ name, def, path, value, onChange, ctx }: Props) {
  const id = useId();
  const target = def.to ?? '';
  const titleField = ctx.contract.collections[target]?.titleField ?? '';
  const choices = ctx.rows.filter(r => r.collection === target).map(r => ({ id: r.id, title: str(r.newest?.data[titleField]) })).sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <label htmlFor={id}>{fieldLabel(name, def)}</label>
      {def.multiple ? (
        <select id={id} multiple value={Array.isArray(value) ? (value as string[]) : []} onChange={e => { const picked = Array.from(e.target.selectedOptions, o => o.value); onChange(path, picked.length ? picked : undefined); }}>
          {choices.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      ) : (
        <select id={id} value={str(value)} onChange={e => onChange(path, e.target.value === '' ? undefined : e.target.value)}>
          <option value="" />
          {choices.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
        </select>
      )}
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

const ADDRESS_KEYS = ['street', 'city', 'region', 'postalCode'];

function AddressWidget({ name, def, path, value, onChange, ctx }: Props) {
  const a = obj(value);
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <fieldset>
        <legend>{fieldLabel(name, def)}</legend>
        {ADDRESS_KEYS.map(k => (
          <label key={k}>{humanize(k)} <input type="text" value={str(a[k])} onChange={e => onChange(path, { ...a, [k]: e.target.value === '' ? undefined : e.target.value })} /></label>
        ))}
      </fieldset>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function GeoWidget({ name, def, path, value, onChange, ctx }: Props) {
  const g = obj(value);
  const put = (k: 'lat' | 'lng', raw: string) => { const next = { ...g, [k]: raw === '' ? undefined : Number(raw) }; onChange(path, next.lat === undefined && next.lng === undefined ? undefined : next); };
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <fieldset>
        <legend>{fieldLabel(name, def)}</legend>
        {(['lat', 'lng'] as const).map(k => (
          <label key={k}>{humanize(k)} <input type="number" step="any" value={typeof g[k] === 'number' ? (g[k] as number) : ''} onChange={e => put(k, e.target.value)} /></label>
        ))}
      </fieldset>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

/** A client-facing fact (`sourced`): the value, its source address and its date (03-FRONTEND B4). */
function Sourced({ name, def, path, value, onChange, ctx }: Props) {
  const v = obj(value);
  const inner: FieldDef = { ...def, sourced: false };
  const put = (k: string, x: unknown) => { const next = { ...v, [k]: x }; onChange(path, next.value === undefined && !next.source && !next.date ? undefined : next); };
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <FieldWidget name={name} def={inner} path={[...path, 'value']} value={v.value} onChange={(_, x) => put('value', x)} ctx={ctx} />
      <label>{humanize('source')} <input type="url" value={str(v.source)} onChange={e => put('source', e.target.value === '' ? undefined : e.target.value)} /></label>
      <label>{humanize('date')} <input type="date" value={str(v.date)} onChange={e => put('date', e.target.value === '' ? undefined : e.target.value)} /></label>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function GroupWidget({ name, def, path, value, onChange, ctx }: Props) {
  return (
    <div data-plan="DP-1.4-13" data-path={pathKey(path)}>
      <fieldset>
        <legend>{fieldLabel(name, def)}</legend>
        {Object.entries(def.of ?? {}).map(([n, d]) => (
          <FieldWidget key={n} name={n} def={d} path={[...path, n]} value={obj(value)[n]} onChange={onChange} ctx={ctx} />
        ))}
      </fieldset>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

/** The row controls of a list (DP-1.4-12): add, remove, move up, move down. */
function RowControls({ i, n, remove, move }: { i: number; n: number; remove: () => void; move: (by: -1 | 1) => void }) {
  return (
    <span data-plan="DP-1.4-12">
      <button type="button" onClick={remove}>Remove</button>
      <button type="button" disabled={i === 0} onClick={() => move(-1)}>Move up</button>
      <button type="button" disabled={i === n - 1} onClick={() => move(1)}>Move down</button>
    </span>
  );
}

function useListOps(path: Path, value: unknown, onChange: Props['onChange']) {
  const items = Array.isArray(value) ? (value as unknown[]) : [];
  return {
    items,
    add: (item: unknown) => onChange(path, [...items, item]),
    remove: (i: number) => onChange(path, items.filter((_, j) => j !== i)),
    move: (i: number, by: -1 | 1) => { const next = [...items]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); onChange(path, next); },
  };
}

function ListWidget({ name, def, path, value, onChange, ctx }: Props) {
  const ops = useListOps(path, value, onChange);
  const atMax = typeof def.max === 'number' && ops.items.length >= def.max;
  return (
    <div data-plan="DP-1.4-12" data-path={pathKey(path)}>
      <fieldset>
        <legend>{fieldLabel(name, def)}</legend>
        <ol>
          {ops.items.map((item, i) => (
            <li key={i}>
              {Object.entries(def.of ?? {}).map(([n, d]) => (
                <FieldWidget key={n} name={n} def={d} path={[...path, i, n]} value={obj(item)[n]} onChange={onChange} ctx={ctx} />
              ))}
              <RowControls i={i} n={ops.items.length} remove={() => ops.remove(i)} move={by => ops.move(i, by)} />
            </li>
          ))}
        </ol>
        <button type="button" disabled={atMax} onClick={() => ops.add({})}>Add</button>
      </fieldset>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

function GalleryWidget({ name, def, path, value, onChange, ctx }: Props) {
  const ops = useListOps(path, value, onChange);
  const atMax = typeof def.max === 'number' && ops.items.length >= def.max;
  return (
    <div data-plan="DP-1.4-12" data-path={pathKey(path)}>
      <fieldset>
        <legend>{fieldLabel(name, def)}</legend>
        <ol>
          {ops.items.map((item, i) => (
            <li key={i}>
              <PhotoSlot label={fieldLabel(name, def)} def={def} path={[...path, i]} value={item} onChange={onChange} ctx={ctx} />
              <RowControls i={i} n={ops.items.length} remove={() => ops.remove(i)} move={by => ops.move(i, by)} />
            </li>
          ))}
        </ol>
        <button type="button" disabled={atMax} onClick={() => ops.add({})}>Add</button>
      </fieldset>
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

/** The photo slot (DP-1.4-11): drop or choose, alt text, the rights tick, "Preparing sizes", then ready; the plan's two error sentences. */
function PhotoSlot({ label, def, path, value, onChange, ctx }: { label: string; def: FieldDef; path: Path; value: unknown; onChange: Props['onChange']; ctx: WidgetCtx }) {
  const photo = obj(value);
  const asset = typeof photo.asset === 'string' ? photo.asset : undefined;
  const alt = str(photo.alt);
  const media = useMedia(asset);
  const url = useSignedUrl(media.data?.path);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const altId = useId();
  const minWidth = def.media?.minWidth;

  const take = async (file: File | undefined) => {
    if (!file) return;
    setProblem('');
    if (!JPG_PNG_WEBP.includes(file.type)) { setProblem(t('DP-1.4-11', 'Use a JPG, PNG or WebP.')); return; }
    const width = await widthOf(file);
    if (minWidth && width !== null && width < minWidth) { setProblem(`${t('DP-1.4-11', 'This photo is')} ${width} ${t('DP-1.4-11', 'px wide; this spot needs')} ${minWidth}.`); return; }
    setBusy(true);
    try {
      const start = await uploadStart(ctx.workspaceId, file);
      await putFile(start.uploadUrl, file);
      await uploadFinish(start.media, false, alt);
      onChange(path, { asset: start.media, ...(alt ? { alt } : {}) });
    } catch (e) {
      setProblem(e instanceof CallFailed ? e.problem.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const drop = (e: DragEvent) => { e.preventDefault(); void take(e.dataTransfer.files[0]); };
  const tick = async (on: boolean) => {
    if (!asset) return;
    setProblem('');
    try { await uploadFinish(asset, on, alt); void media.refetch(); } catch (e) { setProblem(e instanceof CallFailed ? e.problem.message : String(e)); }
  };

  return (
    <div data-plan="DP-1.4-11" data-path={pathKey(path)} onDragOver={e => e.preventDefault()} onDrop={drop}>
      <p>{label}</p>
      {url.data && <img src={url.data} alt={alt} width={160} />}
      <label>Choose <input type="file" accept={JPG_PNG_WEBP.join(',')} disabled={busy} onChange={e => { void take(e.target.files?.[0]); e.target.value = ''; }} /></label>
      {asset && (
        <>
          <label htmlFor={altId}>Alt text</label>
          <input id={altId} type="text" value={alt} onChange={e => onChange(path, { ...photo, alt: e.target.value === '' ? undefined : e.target.value })} />
          {def.media?.rightsConfirm && (
            <label><input type="checkbox" checked={media.data?.rights_confirmed === true} onChange={e => void tick(e.target.checked)} /> Rights</label>
          )}
          {media.data && (media.data.processed ? <p>Ready</p> : <p>Preparing sizes</p>)}
        </>
      )}
      {problem && <p role="alert">{problem}</p>}
      <Errors path={path} ctx={ctx} />
    </div>
  );
}

async function widthOf(file: File): Promise<number | null> {
  try { const bmp = await createImageBitmap(file); const w = bmp.width; bmp.close(); return w; } catch { return null; }
}

/** The search-result card (DP-1.4-16): title and description with their length bars and a Google-style preview that follows the typing. */
function SeoWidget({ name, def, path, value, onChange, ctx }: Props) {
  const s = obj(value);
  const idT = useId(), idD = useId();
  const title = str(s.title), description = str(s.description);
  const put = (k: 'title' | 'description', v: string) => {
    const next = { ...s, [k]: v === '' ? undefined : v };
    onChange(path, next.title === undefined && next.description === undefined ? undefined : next);
  };
  const bar = (n: number, max: number, label: string) => <meter aria-label={label} min={0} max={max} high={max} optimum={0} value={Math.min(n, max)} data-over={n > max ? 'true' : 'false'} />;
  return (
    <div data-plan="DP-1.4-16" data-path={pathKey(path)}>
      <label htmlFor={idT}>{fieldLabel('title')}</label>
      <input id={idT} type="text" value={title} onChange={e => put('title', e.target.value)} />
      <Counter n={title.length} max={SEO_TITLE_MAX} label={fieldLabel('title')} short={seoShort('title', title)} min={SEO_TITLE_MIN} />
      {bar(title.length, SEO_TITLE_MAX, 'Title')}
      <label htmlFor={idD}>{fieldLabel('description')}</label>
      <textarea id={idD} value={description} onChange={e => put('description', e.target.value)} />
      <Counter n={description.length} max={SEO_DESCRIPTION_MAX} label={fieldLabel('description')} short={seoShort('description', description)} min={SEO_DESCRIPTION_MIN} />
      {bar(description.length, SEO_DESCRIPTION_MAX, 'Description')}
      <figure>
        <p>{title}</p>
        <p>{ctx.host}{ctx.pagePath}</p>
        <p>{description}</p>
      </figure>
      <Errors path={[...path, 'title']} ctx={ctx} />
      <Errors path={[...path, 'description']} ctx={ctx} />
      <Errors path={path} ctx={ctx} />
    </div>
  );
}
