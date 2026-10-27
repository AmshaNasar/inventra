/* =====================================================================
   INVENTRA FRONTEND · Scenario Lab, approvals, draft PO, corrections,
   decisions, evaluation, assistant drawer, boot
   ===================================================================== */

/* ================= SCENARIO LAB (decision tree, S1 to S9) ================= */
let LAB = {key:null, tree:null, treeAt:null, sel:null, cmp:[], b:{type:'transfer'}, msg:null, qbusy:false, filled:false, question:null, parsedAssumptions:null, bp:{}, loading:false};
let TREES = {};
try { TREES = JSON.parse(localStorage.getItem('inventra-trees') || '{}'); } catch (e) {}
const saveTrees = () => { try { localStorage.setItem('inventra-trees', JSON.stringify(TREES)); } catch (e) {} };
function labKey(){
  if (!LAB.key || !CELL[LAB.key]){ const r = S.plan.queue.find(x => x.trigger === 'shortage_or_breach') || S.plan.queue[0]; LAB.key = r ? key(r.sku, r.location) : 'CHG-01|Abu Dhabi'; }
  return LAB.key;
}
async function loadTree(){
  if (LAB.loading) return;
  const k = labKey(), [sku, loc] = k.split('|');
  LAB.loading = true; busy('Building the decision tree on the server…');
  try {
    let t = null;
    if (TREES[k]){ try { t = await api(`/scenario/trees/${encodeURIComponent(TREES[k])}`); } catch (e) { if (!(e instanceof ApiError && e.status === 404)) throw e; } }
    if (!t){ t = await api('/scenario/trees', {method:'POST', body:{sku, location:loc}}); TREES[k] = t.tree_id; saveTrees(); }
    LAB.tree = t; LAB.treeAt = S.loadedAt;
    if (!t.nodes.find(n => n.node_id === LAB.sel)) LAB.sel = (t.nodes.find(n => n.source === 'Suggested') || t.nodes[0]).node_id;
    if (!LAB.b.parent || !t.nodes.find(n => n.node_id === LAB.b.parent)) LAB.b.parent = LAB.sel;
    if (LAB.pendingBuilder){ Object.assign(LAB.b, LAB.pendingBuilder); LAB.pendingBuilder = null; LAB.b.parent = t.nodes.find(n => !n.parent_id).node_id; }
  } catch (e) { LAB.tree = {error: errMsg(e)}; }
  finally { LAB.loading = false; unbusy(); if (CURRENT === 'lab') render('lab', true); }
}
async function refreshTree(){ LAB.tree = null; await loadTree(); }
function openLab(k, opts){
  if (!k) k = labKey();
  if (k !== LAB.key){ LAB.tree = null; LAB.cmp = []; LAB.sel = null; LAB.bp = {}; }
  LAB.key = k; LAB.msg = null;
  const [sku, loc] = k.split('|');
  if (opts && opts.builder) LAB.pendingBuilder = opts.builder;
  else LAB.b = {type:'transfer', sku, to:loc, from:LOCS.find(l => l.id !== loc).id, qty:50};
  closePilot(); go('lab');
}
const nodeById = id => LAB.tree.nodes.find(n => n.node_id === id);
const nodePath = id => (nodeById(id) || {path_ids:[]}).path_ids.map(nodeById);
function nodeBreach(res, loc){ return sum(Object.values(res.per_sku || {}).map(p => (p.results.buffer_breach_days || {})[loc] || 0)); }
function nodeCost(res){ return sum(Object.values(res.per_sku || {}).map(p => (p.results.transfer_cost_aed || 0) + (p.results.expedite_cost_aed || 0))); }
function nodeCard(n, depth){
  const res = n.results || {}, t = res.totals || {}, root = !n.parent_id, sel = LAB.sel === n.node_id, cmp = LAB.cmp.includes(n.node_id);
  const failsRule = !root && res.rule && !res.rule.passes;
  return `<div class="tnode ${sel ? 'sel' : ''} ${root ? 'root' : ''}" style="--dep:${depth}" onclick="if(!event.target.closest('input,button')){LAB.sel=${jsq(n.node_id)};LAB.b.parent=${jsq(n.node_id)};render('lab',true)}">
    <div class="tn-h"><span class="tn-src ${esc(n.source)}">${esc(n.source)}</span><b>${esc(n.label)}</b>${root ? '' : robTag(n.robustness)}${failsRule ? '<span class="tag bad">fails rule</span>' : ''}<span class="sp1"></span>${root ? '' : `<label class="cmpk" title="Compare"><input type="checkbox" ${cmp ? 'checked' : ''} onchange="toggleCmp(${jsq(n.node_id)})"> compare</label>`}</div>
    <div class="tn-m"><span>${root ? 'Reference' : `<b class="${t.net_vs_do_nothing_aed >= 0 ? '' : 'down'}">${sgn(t.net_vs_do_nothing_aed)}</b> vs Do nothing`}</span>${root ? '' : `<span>${sgn(t.net_vs_parent_aed)} vs parent</span>`}<span>${fmt(t.lost_sales)} lost</span><span>${sum(LOCS.map(l => nodeBreach(res, l.id)))} breach days</span>${root ? '' : `<span>${aed(nodeCost(res))} cost</span>`}</div>
    ${(res.flags || []).length ? `<div class="tn-n">${res.flags.map(esc).join('<br>')}</div>` : ''}
    ${n.question_text ? `<div class="tn-n">“${esc(n.question_text)}”</div>` : ''}
  </div>`;
}
function treeHTML(){
  const out = [], walk = (n, d) => { out.push(nodeCard(n, d)); LAB.tree.nodes.filter(x => x.parent_id === n.node_id).forEach(c => walk(c, d + 1)); };
  walk(LAB.tree.nodes.find(n => !n.parent_id), 0);
  return out.join('');
}
function toggleCmp(id){ LAB.cmp = LAB.cmp.includes(id) ? LAB.cmp.filter(x => x !== id) : [...LAB.cmp, id].slice(-2); render('lab', true); }
function outputsTable(ids){
  const cols = ids.map(nodeById).filter(Boolean);
  const row = (label, f) => `<tr><td>${label}</td>${cols.map(n => `<td class="r">${f(n.results || {}, n)}</td>`).join('')}</tr>`;
  return `<table class="out-t"><thead><tr><th></th>${cols.map(n => `<th class="r">${esc(n.label)}</th>`).join('')}</tr></thead><tbody>
    ${row('Units sold', r => fmt(r.totals.units_sold))}${row('Lost sales', r => fmt(r.totals.lost_sales))}
    ${LOCS.map(l => row(`Buffer-breach days · ${l.name}`, r => nodeBreach(r, l.id))).join('')}
    ${row('Excess units, day 30', r => fmt(r.totals.excess_units))}${row('Aged units, day 30', r => fmt(r.totals.aged_units))}
    ${row('Holding cost', r => aed(r.totals.holding_cost_aed))}${row('Transfer and expedite cost', r => aed(nodeCost(r)))}
    ${row('Net benefit vs Do nothing', (r, n) => n.parent_id ? `<b>${sgn(r.totals.net_vs_do_nothing_aed)}</b>` : '—')}${row('Added vs parent', (r, n) => n.parent_id ? sgn(r.totals.net_vs_parent_aed) : '—')}
    ${row('Robustness', r => r.robustness || '—')}${row('Recommendation rule', (r, n) => !n.parent_id ? '—' : r.rule.passes ? 'passes' : esc(r.rule.failing_checks[0] || 'fails'))}
  </tbody></table>`;
}
function builderHTML(){
  const [sku, loc] = labKey().split('|'), b = LAB.b;
  const pos = []; S.stock.filter(r => r.sku === sku).forEach(r => r.incoming.forEach(p => pos.push({...p, location:r.location})));
  const locSel = (k, v) => `<select class="sel" id="bd-${k}" onchange="LAB.b.${k}=this.value">${LOCS.map(l => `<option value="${esc(l.id)}" ${v === l.id ? 'selected' : ''}>${l.name}</option>`).join('')}</select>`;
  const num = (k, v, lab) => `<label class="bf"><span>${lab}</span><input type="number" id="bd-${k}" value="${v ?? ''}" oninput="LAB.b.${k}=+this.value"></label>`;
  const poSel = () => `<select class="sel" id="bd-po" onchange="LAB.b.po_id=this.value">${pos.map(p => `<option value="${esc(p.po_id)}" ${b.po_id === p.po_id ? 'selected' : ''}>${esc(p.po_id)} · ${p.qty} → ${esc(locName(p.location))} · ${esc(p.status)}</option>`).join('') || '<option value="">no inbound order</option>'}</select>`;
  if (['bring_forward','delay_inbound','reduce_inbound'].includes(b.type) && !b.po_id && pos[0]) b.po_id = pos[0].po_id;
  let fields = '';
  if (b.type === 'transfer') fields = `<label class="bf"><span>From</span>${locSel('from', b.from)}</label><label class="bf"><span>To</span>${locSel('to', b.to || loc)}</label>${num('qty', b.qty, 'Units')}`;
  if (b.type === 'reorder') fields = `<label class="bf"><span>For</span>${locSel('location', b.location || loc)}</label>${num('qty', b.qty, 'Units')}${num('order_day', b.order_day, 'Order on plan day (blank = order-by)')}`;
  if (b.type === 'bring_forward') fields = `<label class="bf"><span>Order</span>${poSel()}</label>${num('days', b.days, 'Days (blank = PO expedite days)')}`;
  if (b.type === 'delay_inbound') fields = `<label class="bf"><span>Order</span>${poSel()}</label>${num('days', b.days ?? 14, 'Days')}`;
  if (b.type === 'reduce_inbound') fields = `<label class="bf"><span>Order</span>${poSel()}</label>${num('new_qty', b.new_qty, 'New quantity')}`;
  if (b.type === 'wait') fields = `<label class="bf"><span>At</span>${locSel('location', b.location || loc)}</label>`;
  return `<div class="builder ${LAB.filled ? 'filled' : ''}">
    <label class="bf"><span>Add under</span><select class="sel" onchange="LAB.b.parent=this.value">${LAB.tree.nodes.map(n => `<option value="${esc(n.node_id)}" ${b.parent === n.node_id ? 'selected' : ''}>${esc(n.label)}</option>`).join('')}</select></label>
    <label class="bf"><span>Decision</span><select class="sel" onchange="LAB.b.type=this.value;LAB.filled=false;render('lab',true)">${[['transfer','Transfer (one leg; stack legs for a split)'],['reorder','Reorder'],['bring_forward','Bring an inbound order forward'],['delay_inbound','Delay an inbound order'],['reduce_inbound','Reduce an inbound order'],['wait','Wait for inbound']].map(([v, l]) => `<option value="${v}" ${b.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    ${fields}
    <button class="btn sm acc" onclick="runBuilder()">${IC.plus} Run</button>
  </div>`;
}
function builderPayload(){
  const [sku, loc] = labKey().split('|'), b = LAB.b, d = {type:b.type, sku};
  if (b.type === 'transfer'){ if (b.legs && b.legs.length){ d.legs = b.legs; d.type = 'split'; } else { d.from = b.from; d.to = b.to || loc; d.qty = +b.qty; } }
  if (b.type === 'reorder'){ d.location = b.location || loc; d.qty = +b.qty; if (b.order_day !== undefined && b.order_day !== null && b.order_day !== '' && !Number.isNaN(+b.order_day)) d.order_day = +b.order_day; }
  if (['bring_forward','delay_inbound','reduce_inbound'].includes(b.type)){ d.po_id = b.po_id; if (b.type !== 'reduce_inbound' && b.days) d.days = +b.days; if (b.type === 'reduce_inbound') d.new_qty = +b.new_qty; }
  if (b.type === 'wait'){ d.location = b.location || loc; }
  return d;
}
async function runBuilder(){
  const decision = builderPayload(), tid = LAB.tree.tree_id;
  busy('Simulating the new node (9 demand and delay cases)…');
  try {
    if (LAB.parsedAssumptions){ await api(`/scenario/trees/${encodeURIComponent(tid)}/assumptions`, {method:'PATCH', body:LAB.parsedAssumptions}); LAB.parsedAssumptions = null; }
    const n = await api(`/scenario/trees/${encodeURIComponent(tid)}/nodes`, {method:'POST', body:{parent_id:LAB.b.parent || LAB.tree.nodes[0].node_id, decision, source: LAB.filled ? 'Question' : 'Controls', question_text: LAB.filled ? LAB.question : null}});
    LAB.sel = n.node_id; LAB.b.parent = n.node_id; LAB.filled = false; LAB.question = null; LAB.msg = null;
    LAB.tree = await api(`/scenario/trees/${encodeURIComponent(tid)}`); LAB.treeAt = S.loadedAt;
  } catch (e) { LAB.msg = {bad:true, text:esc(errMsg(e))}; }
  finally { unbusy(); render('lab', true); }
}
async function setAssume(patch){
  busy('Recomputing every node under the new assumptions…');
  try { LAB.tree = await api(`/scenario/trees/${encodeURIComponent(LAB.tree.tree_id)}/assumptions`, {method:'PATCH', body:patch}); LAB.treeAt = S.loadedAt; }
  catch (e) { toast(errMsg(e)); }
  finally { unbusy(); render('lab', true); }
}
function sigCase(id, kind, c){
  const s = S.signals.find(x => x.signal_id === id), cur = {...(LAB.tree.assumptions.signals || {})};
  cur[id] = {...(cur[id] || {}), [kind + '_likely']: s[kind + '_' + c]};
  setAssume({signals:cur});
}
function sigToggle(id, on){ const cur = {...(LAB.tree.assumptions.signals || {})}; cur[id] = {...(cur[id] || {}), include:on}; setAssume({signals:cur}); }
function sandboxFree(sku, loc, free){
  const r = CELL[key(sku, loc)].stock, list = (LAB.tree.assumptions.stock_corrections || []).filter(x => !(x.sku === sku && x.location === loc));
  if (+free !== r.free.value) list.push({sku, location:loc, available:+free + r.reserved.value, reserved:r.reserved.value});
  setAssume({stock_corrections:list});
}
async function askWhatIf(q){
  if (!q || !q.trim()) return;
  if (!keyed()){ LAB.msg = {bad:true, text:'Typed questions need the backend LLM. Use the builder controls below.'}; render('lab', true); return; }
  if (!LAB.tree || LAB.tree.error){ await loadTree(); if (!LAB.tree || LAB.tree.error) return; }
  LAB.qbusy = true; LAB.msg = {text:'Translating your question into builder fields…'}; if (CURRENT === 'lab') render('lab', true);
  let r = null;
  try { r = await api('/scenario/parse', {method:'POST', body:{tree_id:LAB.tree.tree_id, question:q}}); }
  catch (e) { LAB.qbusy = false; LAB.msg = {bad:true, text:`${esc(errMsg(e))} Nothing ran.`}; if (CURRENT === 'lab') render('lab', true); return; }
  LAB.qbusy = false;
  if (!r.supported){ LAB.msg = {bad:true, text:`${esc(r.message)}. Missing: ${esc(r.missing_input)}.`}; if (CURRENT === 'lab') render('lab', true); return; }
  const d = r.builder.decision;
  const dest = d.to || d.location || (d.legs && d.legs[0] && d.legs[0].to) || (d.po_id ? (S.stock.find(x => x.incoming.some(p => p.po_id === d.po_id)) || {}).location : null) || labKey().split('|')[1];
  const nk = key(d.sku, dest);
  const b = {type: d.type === 'split' ? 'transfer' : d.type, sku:d.sku, from:d.from, to:d.to, qty:d.qty, legs:d.legs, location:d.location, order_day:d.order_day, po_id:d.po_id, days:d.days, new_qty:d.new_qty};
  LAB.filled = true; LAB.question = r.question_text; LAB.parsedAssumptions = r.builder.assumptions || null;
  LAB.msg = {text:`Filled the builder from your question${nk !== labKey() ? `, on the ${esc(d.sku)} → ${esc(locName(dest))} tree` : ''}${LAB.parsedAssumptions ? ', including tree-wide assumptions applied when you press Run' : ''}. Check the fields, then press Run. Nothing has run.`};
  if (nk !== labKey()){ const msg = LAB.msg, fq = LAB.question, pa = LAB.parsedAssumptions; openLab(nk, {builder:b}); LAB.msg = msg; LAB.filled = true; LAB.question = fq; LAB.parsedAssumptions = pa; }
  else { Object.assign(LAB.b, b, {parent:LAB.sel}); if (CURRENT !== 'lab') go('lab'); else render('lab', true); }
}
function viewLab(){
  const k = labKey(), [sku, loc] = k.split('|'), c = CELL[k], r = recOf(k);
  const opts = [...new Set([k, ...RECS.map(x => x.key)])];
  const head = `<div class="card rv" style="--d:.04s"><div class="row" style="justify-content:space-between;gap:14px">
    <div class="row" style="gap:12px"><span class="lbl">Tree</span><select class="sel" aria-label="SKU and location" onchange="openLab(this.value)">${opts.map(x => { const rr = recOf(x); return `<option value="${esc(x)}" ${x === k ? 'selected' : ''}>${esc(x.replace('|', ' → '))}${rr ? ' · ' + rr.urgency + (rr.top ? '' : ' · no option passes') : ''}</option>`; }).join('')}</select>${r ? urgTag(r.urgency) : ''}<span class="cellb st-${stCls(c.plan.status)}" style="display:inline-flex;min-width:0;padding:3px 8px 3px 10px">${esc(c.plan.status)}</span></div>
    <div class="row muted" style="font-size:12px">${esc(SKU_NAME(sku))} · free ${fmt(c.stock.free.value)} · safety ${fmt(c.stock.safety_stock.value)} · P50 ${fmt(c.fc.p50)}${c.plan.breach_day != null ? ' · breach ' + pdlab(c.plan.breach_day) : ''}</div></div></div>`;
  if (!LAB.tree || LAB.treeAt !== S.loadedAt){ if (!LAB.loading) setTimeout(loadTree, 0); return secHead('lab') + head + '<div class="card" style="margin-top:14px"><div class="empty">Building the decision tree on the server…</div></div>'; }
  if (LAB.tree.error) return secHead('lab') + head + `<div class="warnbox" style="margin-top:14px">${esc(LAB.tree.error)} <button class="btn xs" onclick="refreshTree()">Retry</button></div>`;
  const t = LAB.tree, a = t.assumptions;
  if (!nodeById(LAB.sel)) LAB.sel = t.nodes[0].node_id;
  const selN = nodeById(LAB.sel), root = !selN.parent_id, selR = selN.results || {};
  const path = nodePath(LAB.sel);
  const q = (S.plan.questions || []).find(x => !ANSWERED[x.po_id] && x.effects.some(e => e.sku === sku && e.location === loc));
  const qe = q && q.effects.find(e => e.sku === sku && e.location === loc);
  const sigIds = [...new Set(S.stock.filter(x => x.sku === sku).flatMap(x => x.signals_affecting || []))];
  const sigCtl = S.signals.filter(s => sigIds.includes(s.signal_id));
  const blockers = path.filter(n => n.robustness === 'Harmful' || (n.results.rule && !n.results.rule.passes));
  const fragile = path.some(n => n.robustness === 'Fragile');
  const ex = !root ? lazy('explnode', selN.node_id + '#' + S.loadedAt + '#' + (keyed() ? 'k' : 'l'), () => api(`/explain/${encodeURIComponent(selN.node_id)}`)) : null;
  const bp = LAB.bp[selN.node_id];
  return secHead('lab') + head + `
  ${q ? `<div class="qcard rv" style="--d:.06s;margin-top:14px"><span class="qm">?</span><div class="sp1"><b>${esc(q.question)} It changes the best option.</b><div class="note" style="margin-top:3px">The plan leaves unconfirmed orders out. If confirmed, the top option here becomes <b>${esc(qe.if_confirmed)}</b> instead of <b>${esc(qe.if_unconfirmed)}</b>.</div></div><div class="row"><button class="btn sm acc" onclick="answerQ(${jsq(q.po_id)},true)">Yes, confirmed</button><button class="btn sm" onclick="answerQ(${jsq(q.po_id)},false)">Not yet</button></div></div>` : ''}
  <div class="card rv" style="--d:.08s;margin-top:14px"><div class="card-h"><div><h3>Tree-wide assumptions</h3><div class="hint">Sandbox only: they apply to every node so branches stay comparable, and never change the shared plan. Approving a path re-checks it on the shared plan.</div></div><button class="btn xs" onclick="setAssume({demand:'P50',signals:{},lanes:[],stock_corrections:[]})">Reset</button></div>
    <div class="ctrls">
      <div class="ctrl"><div class="lbl">Demand <b>${esc(a.demand)}</b></div><div class="seg">${['P10','P50','P90'].map(v => `<button class="${a.demand === v ? 'on' : ''}" onclick="setAssume({demand:'${v}'})">${v}</button>`).join('')}</div></div>
      ${sigCtl.map(s => { const kind = s.type === 'supply' ? 'delay' : 'uplift', ov = (a.signals || {})[s.signal_id] || {}, on = ov.include !== false, likely = ov[kind + '_likely'] ?? s[kind + '_likely']; const cs = ['min','likely','max'].find(cc => s[kind + '_' + cc] === likely) || 'custom'; return `<div class="ctrl"><div class="lbl">${esc(s.signal_id)} <b>${on ? cs + ' ' + kind : 'off'}</b></div><div class="row" style="gap:6px"><label class="cmpk"><input type="checkbox" ${on ? 'checked' : ''} onchange="sigToggle(${jsq(s.signal_id)},this.checked)"> on</label><div class="seg">${['min','likely','max'].map(v => `<button class="${cs === v ? 'on' : ''}" onclick="sigCase(${jsq(s.signal_id)},'${kind}','${v}')">${v}</button>`).join('')}</div></div></div>`; }).join('') || '<div class="ctrl"><div class="lbl">Signals <b>none</b></div><div class="note">No supplied signal affects this SKU.</div></div>'}
      <div class="ctrl" style="grid-column:span 2"><div class="lbl">Sandbox stock corrections (free) <b>${(a.stock_corrections || []).length ? 'on' : 'none'}</b></div><div class="row" style="gap:6px">${LOCS.map(l => { const sc = (a.stock_corrections || []).find(x => x.sku === sku && x.location === l.id), cc = CELL[key(sku, l.id)]; const v = sc ? sc.available - (sc.reserved ?? cc.stock.reserved.value) : cc.stock.free.value; return `<label class="bf sm"><span>${l.code}</span><input type="number" value="${v}" onchange="sandboxFree(${jsq(sku)},${jsq(l.id)},this.value)"></label>`; }).join('')}</div></div>
    </div>
  </div>
  <div class="grid">
    <div class="card span-7 rv" style="--d:.12s"><div class="card-h"><div><h3>Decision tree</h3><div class="hint">Each node is one simulation on the server of the root state with every decision on its path applied in order. Click a node to inspect it; tick two to compare.</div></div></div>
      <div class="tree">${treeHTML()}</div>
      <div class="divider"></div>
      <span class="lbl">Scenario builder</span>
      ${keyed() ? `<form class="ask lab-ask" onsubmit="event.preventDefault();askWhatIf($('labQ').value)"><input id="labQ" maxlength="500" placeholder="Type a what-if, e.g. What if we also reorder 50 power banks for Abu Dhabi?" autocomplete="off" ${LAB.qbusy ? 'disabled' : ''}><button class="go" aria-label="Translate" ${LAB.qbusy ? 'disabled' : ''}>${IC.send}</button></form>` : `<div class="note" style="margin:6px 0 2px">Keyless mode: typed questions are hidden. Use the controls.</div>`}
      ${LAB.msg ? `<div class="${LAB.msg.bad ? 'warnbox' : 'note'}" style="margin:8px 0 0">${LAB.msg.text}</div>` : ''}
      ${builderHTML()}
    </div>
    <div class="stack span-5">
      <div class="card rv" style="--d:.16s"><div class="card-h"><div><h3>${esc(selN.label)}</h3><div class="hint">${root ? 'Reference: scheduled inbound orders only.' : `Path: ${path.map(n => esc(n.label)).join(' → ')}`}</div></div>${root ? '' : robTag(selN.robustness)}</div>
        ${outputsTable(LAB.cmp.length === 2 ? LAB.cmp : (root ? [selN.node_id] : [t.nodes[0].node_id, selN.node_id]))}
        ${LAB.cmp.length === 2 ? '<div class="note" style="margin-top:6px">Comparing the two ticked nodes. Untick one to go back.</div>' : ''}
        ${!root && selR.rule && !selR.rule.passes ? `<div class="warnbox">${selR.rule.failing_checks.map(esc).join('<br>')}${selR.rule.details.map(d => (d.safe.failures || []).concat(d.feasible.failures || []).map(x => '<br>' + esc(x)).join('')).join('')}</div>` : ''}
        ${!root && (selR.robustness_failing_cases || []).length ? `<details class="receipt" style="margin-top:8px"><summary><span>${selR.robustness_failing_cases.length} of 9 cases fail</span><span class="muted">${esc(selR.robustness)}</span></summary><div class="rbody">${selR.robustness_failing_cases.map(x => `<div class="ln"><span>${esc(x)}</span></div>`).join('')}</div></details>` : ''}
        <div class="row" style="margin-top:12px">${path.length ? `<button class="btn sm acc" ${blockers.length ? 'disabled' : ''} onclick="approvePath()">Approve path (${path.length} decision${path.length > 1 ? 's' : ''})</button>` : ''}${blockers.length ? `<span class="note down">${esc(blockers[0].label)} is ${blockers[0].robustness === 'Harmful' ? 'Harmful' : 'rejected by the rule'}; this path cannot be approved.</span>` : fragile && path.length ? '<span class="note">Contains a Fragile node: a one-line reason is required.</span>' : ''}</div>
        ${t.assumptions && (t.assumptions.demand !== 'P50' || Object.keys(t.assumptions.signals || {}).length || (t.assumptions.stock_corrections || []).length) && path.length ? '<div class="note" style="margin-top:6px">Sandbox assumptions are on. Approval re-checks this path on the shared plan and records the assumptions on the receipt.</div>' : ''}
      </div>
      ${!root ? `<div class="card rv" style="--d:.24s"><div class="card-h"><div><h3>Explanation</h3><div class="hint">${keyed() ? 'Written by the backend LLM from computed facts; every figure is checked by the validator.' : 'Keyless: template sentence and facts table.'}</div></div></div><div id="nodeExpl">${ex ? explainHTML(ex) : '<div class="note">Writing a verified explanation…</div>'}</div></div>` : ''}
      ${!root ? `<div class="card rv" style="--d:.28s"><div class="card-h"><div><h3>Breaking points</h3><div class="hint">Where this path stops paying back, or the top option changes, one input at a time.</div></div>${bp ? '' : `<button class="btn xs" onclick="loadBP(${jsq(selN.node_id)})">Compute</button>`}</div>
        ${bp ? (bp.error ? `<div class="warnbox">${esc(bp.error)}</div>` : `<div class="bp">${bp.inputs.map(x => `<div><span class="lbl">${esc(x.input)}</span><b>${x.net_zero_at == null ? '—' : 'net 0 at ' + r2(x.net_zero_at)}</b><span class="note">now ${r2(x.current_value)}${x.top_option_changes_at != null ? ` · top option changes at ${r2(x.top_option_changes_at)} (${esc(x.new_top_option || '')})` : ''}</span></div>`).join('')}</div><div class="note" style="margin-top:6px">Current net ${aed(bp.current_net_aed)} · current top option: ${esc(bp.current_top_option || 'none passes')}</div>`) : '<div class="note">The server bisects shipping cost, lane lead days and demand. It can take up to a minute.</div>'}</div>` : ''}
    </div>
  </div>`;
}
RENDER.lab = viewLab;
AFTER.lab = () => bindCharts($('v-lab'));
async function loadBP(id){
  busy('Computing breaking points on the server…');
  try { LAB.bp[id] = await api(`/scenario/nodes/${encodeURIComponent(id)}/breaking-points`); }
  catch (e) { LAB.bp[id] = {error: errMsg(e)}; }
  finally { unbusy(); render('lab', true); }
}
function answerQ(po, yes){
  if (!yes){ ANSWERED[po] = 'no'; try { localStorage.setItem('inventra-answered', JSON.stringify(ANSWERED)); } catch (e) {} toast(`${po} stays out of the plan until it is confirmed`); render(CURRENT, true); refreshChrome(); return; }
  const q = (S.plan.questions || []).find(x => x.po_id === po);
  reasonModal(`Confirm ${esc(po)}`, `Records a correction on ${esc(po)} (status → Confirmed). The order then counts in the plan, which re-runs.`, why =>
    mutate(`Confirming ${po} and re-planning…`, () => api('/corrections', {method:'POST', body:{record_id:q.how_to_answer.body.record_id, field:'status', new_value:'Confirmed', reason:why}})), 'Confirm and re-plan', 'e.g. Supplier confirmed by email on 27 Oct');
}

/* ================= explanations ================= */
function renderCited(text, fx){
  return esc(text).replace(/\[([FR]\d+(?:\s*,\s*[FR]\d+)*)\]/g, (m, ids) => ids.split(/\s*,\s*/).map(id => {
    const f = fx.facts.find(x => x.id === id), r = fx.reasons.find(x => x.id === id);
    if (f) return `<button type="button" class="fact" title="${esc(f.label)}: ${esc(f.value)}${f.unit ? ' ' + esc(f.unit) : ''} · ${esc(f.tag)}">${id}</button>`;
    if (r) return `<button type="button" class="fact rsn" title="${esc(r.text)} · ${esc(r.tag)}">${id}</button>`;
    return `<span class="fact" style="color:var(--bad)">${id}?</span>`;
  }).join(''));
}
function factsTable(fx, note){
  return `${note ? `<div class="warnbox">${note}</div>` : ''}<div class="tscroll"><table class="t ftable"><tbody>${fx.facts.map(f => `<tr><td class="mono muted">${f.id}</td><td>${esc(f.label)}</td><td class="r"><b>${esc(typeof f.value === 'number' ? fmt(f.value) : f.value)}${f.unit ? ' ' + esc(f.unit) : ''}</b></td><td>${evTag(f.tag)}</td></tr>`).join('')}${fx.reasons.map(r => `<tr><td class="mono muted">${r.id}</td><td colspan="2">${esc(r.text)}</td><td>${evTag(r.tag)}</td></tr>`).join('')}</tbody></table></div>`;
}
function explainHTML(x){
  if (x.error) return `<div class="warnbox">${esc(x.error)}</div>`;
  if (keyed() && x.text) return `<div class="narr">${renderCited(x.text, x.facts)}</div><div class="row" style="margin-top:10px"><span class="vbadge">${IC.shield} ${esc(x.badge)}</span><span class="note">Backend LLM${x.cached ? ' · cached' : ''}</span></div>`;
  const note = keyed() && x.fallback ? `<b>${esc(x.fallback)}.</b>` : null;
  return `<div class="narr">${renderCited(x.template, x.facts)}</div><div class="row" style="margin:10px 0"><span class="note">${keyed() ? 'Template' : 'Keyless template'} · every figure comes from the fact set</span></div>${factsTable(x.facts, note)}`;
}

/* ================= approvals ================= */
let REASON_CB = null;
function reasonModal(title, text, cb, btn, ph){
  REASON_CB = cb;
  openModal(`<h3>${title}</h3><div class="hint">${text}</div><div class="field" style="margin-top:14px"><label for="rsR">Reason</label><input id="rsR" maxlength="500" placeholder="${esc(ph || 'e.g. Accept the risk at P90; review on Thursday')}"></div><div class="row"><button class="btn sm solid" onclick="const v=$('rsR').value.trim();if(!v){$('rsR').style.borderColor='var(--bad)';return}closeModal();REASON_CB(v)">${esc(btn || 'Approve with reason')}</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(() => $('rsR') && $('rsR').focus(), 50);
}
function approveRec(k){
  const r = recOf(k); if (!r || !r.top) return;
  const o = r.top;
  const send = why => mutate('Approving and re-planning…', () => api('/decisions', {method:'POST', body:{action:'approve', sku:r.sku, location:r.location, option_id:o.option_id, expected_input_hash:r.input_hash, reason:why || null}}));
  if (o.robustness === 'Fragile') return reasonModal('Approve a Fragile option', `${esc(o.label)} fails ${(o.robustness_failing_cases || []).length} of 9 demand and delay cases. A one-line reason is required.`, send);
  send(null);
}
function approvePath(){
  const path = nodePath(LAB.sel); if (!path.length) return;
  const send = why => mutate('Approving the path and re-planning…', async () => {
    const res = await api('/decisions', {method:'POST', body:{action:'approve_path', tree_id:LAB.tree.tree_id, node_id:LAB.sel, expected_input_hash:LAB.tree.plan_input_hash, reason:why || null}});
    DSELD = res.decisions[0].decision_id; return res;
  }, {goto:'decisions'});
  if (path.some(n => n.robustness === 'Fragile')) return reasonModal('Approve a path with a Fragile node', 'At least one decision on this path fails some demand and delay cases. A one-line reason is required.', send);
  send(null);
}
function rejectModal(k){
  const r = recOf(k), o = r.top;
  openModal(`<h3>Reject this option</h3><div class="hint">${esc(r.sku)} → ${esc(locName(r.location))} · ${esc(o.label)}. A reason is required and goes into the decision log.</div>
    <div class="field" style="margin-top:14px"><label for="rjR">Reason</label><textarea id="rjR" rows="3" maxlength="500" placeholder="e.g. Dubai team cannot load a truck before Thursday"></textarea></div>
    <div class="row"><button class="btn sm solid" onclick="doReject(${jsq(k)})">Reject and log</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
  setTimeout(() => $('rjR').focus(), 50);
}
function doReject(k){
  const why = $('rjR').value.trim(); if (!why){ $('rjR').style.borderColor = 'var(--bad)'; return; }
  const r = recOf(k); closeModal();
  mutate('Logging the rejection…', () => api('/decisions', {method:'POST', body:{action:'reject', sku:r.sku, location:r.location, option_id:r.top.option_id, reason:why}}));
}

/* ================= draft PO with soft guardrail (N4) ================= */
let PO = {key:null, last:null, t:null};
async function poModal(k){
  const [sku, loc] = k.split('|');
  PO = {key:k, last:null, t:null};
  busy('Preparing the draft PO…');
  let d; try { d = await api('/drafts/po', {method:'POST', body:{sku, location:loc}}); } catch (e) { unbusy(); showError(e); return; }
  unbusy(); PO.last = d;
  const g = d.guardrail.safe_range, p = d.draft_po, ro = d.reorder_plan || {};
  openModal(`<h3>Draft purchase order</h3><div class="hint">${esc(p.supplier)} · ${esc(sku)} ${esc(p.name)} → ${esc(locName(loc))} · ${ro.order_now_note ? esc(ro.order_now_note) : `order by ${dlabIso(p.order_by_date)}`}, arrives ${dlabIso(p.expected_arrival)}. Draft only: never sent.</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:14px"><div class="field"><label for="poQ">Quantity</label><input id="poQ" type="number" min="1" value="${p.prefilled_qty}" oninput="poCheck()"></div><div class="field"><label>Safe range</label><div style="padding:9px 0;font-variant-numeric:tabular-nums"><b>${fmt(g.min_qty_covers_p10_need)} – ${fmt(g.max_qty_max_cover_on_arrival)}</b> units <span class="note">recommended ${fmt(p.prefilled_qty)}</span></div></div></div>
    <div class="note">${esc(d.guardrail.formula)}. Lead time ${p.lead_time.lead_days} days (supplier mean ${r1(p.lead_time.mean_past_lead_days)}${p.lead_time.signals.length ? ' + ' + esc(p.lead_time.signals.join(', ')) + ' ' + p.lead_time.signal_delay_days + ' d' : ''}).${ro.moq_forced_excess ? ' <b>MOQ forces cover above the cap; flagged.</b>' : ''}</div>
    <div class="note" style="margin-top:6px">Assumption shown on every reorder receipt: purchase cost is not counted as a loss because ordered units stay saleable; over-ordering is penalised through holding cost, ageing cost and the max-cover cap.</div>
    <div id="poW"></div><div id="poBtns" class="row" style="margin-top:14px"></div>`);
  poRenderCheck(d);
}
function poCheck(){
  clearTimeout(PO.t);
  PO.t = setTimeout(async () => {
    const [sku, loc] = PO.key.split('|'), q = Math.round(+$('poQ').value || 0);
    if (q <= 0){ $('poW').innerHTML = '<div class="warnbox">Quantity must be positive.</div>'; $('poBtns').innerHTML = ''; return; }
    try { PO.last = await api('/drafts/po', {method:'POST', body:{sku, location:loc, qty:q}}); poRenderCheck(PO.last); } catch (e) { $('poW').innerHTML = `<div class="warnbox">${esc(errMsg(e))}</div>`; }
  }, 350);
}
function poRenderCheck(d){
  const g = d.guardrail, r = g.risk || {};
  let w = '';
  if (!g.in_range && r.units_above_max_cover != null) w = `<div class="warnbox"><b>Above the safe range.</b> ${fmt(r.units_above_max_cover)} units sit above max cover, adding ${aed(r.extra_holding_cost_aed_in_horizon)} of holding cost in 30 days. ${r.note ? esc(r.note) : ''}</div>`;
  else if (!g.in_range && r.units_below_p10_need != null) w = `<div class="warnbox"><b>Below the safe range.</b> ${fmt(r.units_below_p10_need)} units below the P10 need: ${fmt(r.extra_lost_sales_p50)} more units of lost sales at P50 than at the bottom of the range.</div>`;
  $('poW').innerHTML = w;
  $('poBtns').innerHTML = w ? `<button class="btn sm solid" onclick="poToLab()">${IC.flask} Test in Scenario Lab</button><button class="btn sm" onclick="poOverride()">Override with reason</button><button class="btn sm" onclick="closeModal()">Cancel</button>`
    : `<button class="btn sm acc" onclick="poSave(null)">Create draft PO</button><button class="btn sm" onclick="closeModal()">Cancel</button>`;
}
function poToLab(){ const [sku, loc] = PO.key.split('|'), q = Math.round(+$('poQ').value); closeModal(); openLab(PO.key, {builder:{type:'reorder', sku, location:loc, qty:q}}); }
function poOverride(){
  $('poBtns').innerHTML = `<div class="field sp1" style="margin:0"><label for="poR">Reason for override</label><input id="poR" maxlength="500" placeholder="e.g. Supplier price break at this quantity"></div><button class="btn sm solid" style="align-self:flex-end" onclick="const v=$('poR').value.trim();if(!v){$('poR').style.borderColor='var(--bad)';return}poSave(v)">Override and log</button>`;
}
function poSave(reason){
  const [sku, loc] = PO.key.split('|'), q = Math.round(+$('poQ').value), h = PO.last.input_hash;
  closeModal();
  mutate('Saving the draft PO…', async () => {
    const r = await api('/drafts/po', {method:'POST', body:{sku, location:loc, qty:q, save:true, override_reason:reason, expected_input_hash:h}});
    DSELD = r.decision.decision_id; return r;
  }, {goto:'decisions', onError: e => {
    if (e instanceof ApiError && e.status === 422 && /reason/i.test(e.message)){ reasonModal('A reason is required', esc(e.message), why => poSaveWith(sku, loc, q, h, why), 'Save with reason'); return true; }
    return false;
  }});
}
function poSaveWith(sku, loc, q, h, why){
  mutate('Saving the draft PO…', async () => { const r = await api('/drafts/po', {method:'POST', body:{sku, location:loc, qty:q, save:true, override_reason:why, expected_input_hash:h}}); DSELD = r.decision.decision_id; return r; }, {goto:'decisions'});
}

/* ================= corrections (G2, D4) ================= */
function correctModal(o){
  const fields = [['inventory','available'],['inventory','reserved'],['safety_stock','units']];
  const evid = [...new Set((S.validation.issues || []).map(i => i.evidence_record_id).filter(Boolean))];
  openModal(`<h3>Correct a record</h3><div class="hint">Correct once, update everywhere. The original stays in the log; forecast, plan and impact re-run on the server and affected decisions turn Stale. Cite an evidence record where one exists.</div>
    <div class="grid" style="grid-template-columns:1fr 1fr 1fr;margin-top:14px">
      <div class="field"><label for="crS">SKU</label><select id="crS" onchange="crSync()">${SKUS().map(s => `<option ${s === o.sku ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>
      <div class="field"><label for="crL">Location</label><select id="crL" onchange="crSync()">${LOCS.map(l => `<option value="${esc(l.id)}" ${l.id === o.loc ? 'selected' : ''}>${l.name}</option>`).join('')}</select></div>
      <div class="field"><label for="crF">Field</label><select id="crF" onchange="crSync()">${fields.map(([a, b]) => `<option value="${a}.${b}" ${(a === (o.table || 'inventory') && b === o.field) ? 'selected' : ''}>${a === 'safety_stock' ? 'safety stock' : b}</option>`).join('')}</select></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;margin-top:0"><div class="field"><label>Current value</label><div id="crOld" style="padding:9px 0;font-size:16px;font-weight:600"></div></div><div class="field"><label for="crN">New value</label><input id="crN" type="number" min="0"></div></div>
    <div class="field"><label for="crEv">Evidence record</label><input id="crEv" list="crEvL" value="${esc(o.evidence || '')}" placeholder="e.g. stock_counts:CHG-01|Abu Dhabi|2026-10-27T15:30:00"><datalist id="crEvL">${evid.map(x => `<option value="${esc(x)}">`).join('')}</datalist></div>
    <div class="field"><label for="crR">Reason</label><input id="crR" maxlength="500" value="${esc(o.reason || '')}" placeholder="e.g. Cycle count on 27 Oct"></div>
    <div class="note" id="crSrc"></div><div id="crMsg"></div>
    <div class="row" style="margin-top:14px"><button class="btn sm acc" onclick="saveCorrection()">Save correction</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
  crSync(o.suggest);
  setTimeout(() => $('crN').select(), 60);
}
function crCurrent(){
  const sku = $('crS').value, loc = $('crL').value, [t, f] = $('crF').value.split('.'), r = (CELL[key(sku, loc)] || {}).stock;
  const v = !r ? null : t === 'safety_stock' ? r.safety_stock : r[f];
  return {sku, loc, t, f, v};
}
function crSync(suggest){
  const c = crCurrent();
  $('crOld').textContent = c.v ? fmt(c.v.value) : '—';
  $('crN').value = suggest != null ? suggest : (c.v ? c.v.value : '');
  $('crSrc').textContent = c.v ? `Source: ${srcOf(c.v)}` : '';
}
function saveCorrection(){
  const c = crCurrent(), nv = Math.round(+$('crN').value), why = $('crR').value.trim(), ev = $('crEv').value.trim();
  if (!why){ $('crR').style.borderColor = 'var(--bad)'; $('crR').placeholder = 'A reason is required'; return; }
  if (c.v && nv === c.v.value){ closeModal(); return; }
  const body = {record_id:`${c.t}:${c.sku}|${c.loc}`, field:c.f, new_value:nv, reason:why, evidence_record_id: ev || null};
  busy('Saving the correction and re-planning…');
  api('/corrections', {method:'POST', body}).then(async res => {
    closeModal(); await loadAll(); showRipple(res.what_changed); refreshChrome(); render(CURRENT, true);
  }).catch(e => {
    if (e instanceof ApiError && e.data && e.data.suggested_evidence_record_id){ $('crEv').value = e.data.suggested_evidence_record_id; $('crMsg').innerHTML = `<div class="warnbox">${esc(e.message)} The latest count says ${esc(e.data.counted_units)}. The evidence field is filled in; check the new value and save again.</div>`; }
    else $('crMsg').innerHTML = `<div class="warnbox">${esc(errMsg(e))}</div>`;
  }).finally(unbusy);
}
function paramModal(name){
  const d = (PARAMS.find(p => p[0] === name) || [])[1] || '';
  openModal(`<h3>Change ${esc(name)}</h3><div class="hint">${esc(d)}. A planning parameter is an Assumption; the change is logged as a correction and re-runs the chain.</div>
    <div class="field" style="margin-top:14px"><label for="pmN">New value</label><input id="pmN" ${name === 'confidence_thresholds' ? 'placeholder="10;25;20"' : 'type="number" step="any" min="0"'}></div>
    <div class="field"><label for="pmR">Reason</label><input id="pmR" maxlength="500" placeholder="e.g. Finance policy update"></div><div id="pmMsg"></div>
    <div class="row"><button class="btn sm acc" onclick="saveParam(${jsq(name)})">Save and re-plan</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`);
}
function saveParam(name){
  const nv = $('pmN').value.trim(), why = $('pmR').value.trim();
  if (!why){ $('pmR').style.borderColor = 'var(--bad)'; return; } if (!nv){ $('pmN').style.borderColor = 'var(--bad)'; return; }
  busy('Saving the parameter and re-planning…');
  api('/corrections', {method:'POST', body:{record_id:'planning_parameters:' + name, field:'value', new_value:nv, reason:why}}).then(async res => {
    closeModal(); await loadAll(); showRipple(res.what_changed); refreshChrome(); render(CURRENT, true);
  }).catch(e => { $('pmMsg').innerHTML = `<div class="warnbox">${esc(errMsg(e))}</div>`; }).finally(unbusy);
}

/* ================= DECISIONS (R1, R2) ================= */
let DSELD = null, RECALC = {};
function openDecision(id){ DSELD = id; go('decisions'); }
function viewDecisions(){
  const ds = S.decisions.slice().reverse();
  if (!DSELD && ds[0]) DSELD = ds[0].decision_id;
  const sel = ds.find(x => x.decision_id === DSELD);
  const d = sel ? lazy('dec', sel.decision_id + '#' + sel.status + '#' + S.loadedAt, () => api(`/decisions/${encodeURIComponent(sel.decision_id)}`)) : null;
  const top = S.plan.queue.find(r => !activeDecision(key(r.sku, r.location)));
  return secHead('decisions') + `
  <div class="card rv" style="--d:.05s"><div class="card-h"><div><h3>Decision log</h3><div class="hint">Approved, Rejected, Overridden and Stale. Each row stores a hash of every input it used.</div></div><span class="tag">${ds.length} entries</span></div>
    ${ds.length ? `<div class="tscroll"><table class="t"><thead><tr><th>ID</th><th>Decision</th><th>SKU → location</th><th>Approver</th><th>Time</th><th>Input hash</th><th>Status</th></tr></thead><tbody>${ds.map(x => `<tr class="click ${x.decision_id === DSELD ? 'sel' : ''}" onclick="DSELD=${jsq(x.decision_id)};render('decisions',true)"><td class="mono"><b>${esc(x.decision_id)}</b>${x.path_id ? `<div class="muted" style="font-size:10.5px">${esc(x.path_id)}</div>` : ''}</td><td>${esc(x.chosen.label)}${x.reason ? `<div class="muted" style="font-size:11px">${esc(x.reason)}</div>` : ''}</td><td>${esc(x.sku)} → ${esc(locName(x.location))}</td><td>${esc(x.approver)}</td><td class="mono" style="font-size:11px">${tlab(x.timestamp).slice(5)}</td><td class="mono" style="font-size:11px">${esc(x.input_hash)}</td><td><span class="pill ${esc(x.status)}">${esc(x.status)}</span></td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">No decisions yet. Nothing moves until you approve.${top ? ` <button class="btn xs acc" onclick="openLab(${jsq(key(top.sku, top.location))})">Review ${esc(top.sku)} → ${esc(locName(top.location))} in the Lab</button>` : ''}</div>`}
  </div>
  ${sel ? (d ? (d.error ? `<div class="warnbox">${esc(d.error)}</div>` : decisionDoc(d)) : '<div class="card" style="margin-top:14px"><div class="empty">Loading the receipt…</div></div>') : ''}`;
}
RENDER.decisions = viewDecisions;
const kvVal = v => v == null ? '—' : typeof v === 'object' ? Object.entries(v).map(([a, b]) => `${a} ${typeof b === 'object' ? JSON.stringify(b) : b}`).join(' · ') : typeof v === 'number' ? fmt(v) : String(v);
function decisionDoc(d){
  const R = d.receipt || {}, ch = R.chosen || {}, econ = (R.constraints_checked || {}).economic || {};
  const rc = RECALC[d.decision_id];
  const cons = R.constraints_checked || {};
  const consRows = [
    ['Safety stock under P90', cons.safety_stock && cons.safety_stock.pass, (cons.safety_stock && cons.safety_stock.failures || []).join('; ') || 'no new breach'],
    ['Reserved stock untouched', cons.reserved_stock && cons.reserved_stock.pass, cons.reserved_stock && cons.reserved_stock.rule],
    ['Availability (within spare)', cons.availability && cons.availability.pass, (cons.availability && cons.availability.failures || []).join('; ') || 'legs within spare'],
    ['Lead time inside horizon', cons.lead_time && cons.lead_time.pass, cons.lead_time && cons.lead_time.rule],
    ['Economic (net > 0)', econ.pass, econ.net_benefit_aed != null ? `net ${aed(econ.net_benefit_aed)}` : '']
  ];
  const lt = R.lead_time_breakdown || {};
  return `
  ${d.status === 'Stale' ? `<div class="warnbox rv" style="--d:.06s;margin-top:14px"><b>Stale.</b> An input this decision used has changed (input hash ${esc(d.input_hash)} no longer matches). The decision released its spare-stock lock.
    ${rc ? (rc.recommendation ? `<div style="margin-top:8px">Recalculated: <b>${esc(rc.recommendation.label)}</b> · ${esc(actText(rc.recommendation.decision))} · net ${aed(rc.recommendation.net_benefit_aed)} (was ${esc(d.chosen.label)}).</div>` : '<div style="margin-top:8px">Recalculated: no action needed any more.</div>') : ''}
    <div class="row" style="margin-top:10px">${rc && rc.recommendation ? `<button class="btn sm acc" onclick="approveRecalc(${jsq(d.decision_id)})">Approve the recalculated option</button>` : `<button class="btn sm acc" onclick="recalc(${jsq(d.decision_id)})">Recalculate</button>`}<button class="btn sm" onclick="openLab(${jsq(key(d.sku, d.location))})">Open in the Lab</button></div></div>` : ''}
  <div class="grid">
    <div class="doc span-7 rv" style="--d:.1s">
      <div class="dh"><div><span class="lbl">Decision receipt</span><h3>${esc(d.decision_id)} · ${esc(ch.label || d.chosen.label)}</h3><div class="hint">${esc(d.sku)} ${esc(R.sku_name || '')} → ${esc(locName(d.location))} · ${esc(d.approver)}, ${tlab(d.timestamp)}${d.node_id ? ` · from tree node ${esc(d.node_id)}` : ''}${d.path_id ? ` · ${esc(d.path_id)}` : ''}</div></div><span class="pill ${esc(d.status)}">${esc(d.status)}</span></div>
      ${d.reason ? `<div class="warnbox" style="margin-top:0"><b>${d.status === 'Rejected' ? 'Rejected' : d.status === 'Overridden' ? 'Override' : 'Reason'}:</b> ${esc(d.reason)}</div>` : ''}
      ${R.path ? `<div class="note">Path: ${R.path.map(p => esc(p.label)).join(' → ')}</div>` : ''}
      <h4>Chosen option</h4>
      <div class="brief-row"><div><span class="lbl">Net vs Do nothing</span><b>${aed(ch.net_benefit_aed)}</b></div><div><span class="lbl">Lost sales avoided</span><b>${fmt(econ.lost_sales_avoided)}</b></div><div><span class="lbl">Direct cost</span><b>${aed(econ.direct_cost_aed)}</b></div><div><span class="lbl">Robustness</span><b>${esc((R.robustness || {}).label || '—')}</b></div></div>
      ${(R.robustness || {}).failing_cases && R.robustness.failing_cases.length ? `<div class="note" style="margin-top:6px">Failing cases: ${R.robustness.failing_cases.map(esc).join('; ')}</div>` : ''}
      ${R.draft_po ? `<h4>Draft PO</h4><div class="formula">${esc(R.draft_po.status)} · ${fmt(R.draft_po.qty)} units · order by ${dlabIso(R.draft_po.order_by_date)} · arrives ${dlabIso(R.draft_po.expected_arrival)} · safe range ${fmt(R.guardrail.safe_range.min_qty_covers_p10_need)}–${fmt(R.guardrail.safe_range.max_qty_max_cover_on_arrival)}${R.guardrail.in_range ? '' : ' · outside the safe range'}</div>` : ''}
      <h4>Rejected options and why they lost</h4>
      ${(R.rejected_options || []).map(x => `<div class="rej"><div><b>${esc(x.label)}</b><div class="${(x.failing_checks || []).length ? 'why' : 'muted'}" style="font-size:12px">${esc(x.why)}</div></div><div class="r num-t">${sgn(x.net_benefit_aed)}</div></div>`).join('') || '<div class="empty">No other option was generated.</div>'}
      <h4>Inputs</h4>
      <div class="tscroll"><table class="t ftable"><thead><tr><th>Input</th><th class="r">Value</th><th>Tag</th><th>Source</th></tr></thead><tbody>${(R.inputs || []).map(f => `<tr><td>${esc(f.label)}</td><td class="r"><b>${esc(kvVal(f.value))}</b>${f.unit ? ` <span class="muted">${esc(f.unit)}</span>` : ''}</td><td>${evTag(f.tag)}</td><td class="mono" style="font-size:10.5px">${esc(f.source_file ? srcOf(f) : f.formula || (f.changed_by ? 'changed by ' + f.changed_by : ''))}</td></tr>`).join('')}</tbody></table></div>
      <h4>Constraints checked</h4>
      ${consRows.map(([n, ok, det]) => `<div class="chk"><span class="bx ${ok ? 'y' : 'n'}">${ok ? '✓' : '✕'}</span><div><b>${esc(n)}</b><div class="muted">${esc(det || '')}</div></div><span></span></div>`).join('')}
      <h4>Lead-time breakdown</h4>
      ${lt.legs ? lt.legs.map(l => `<div class="formula">Transfer ${esc(l.from)} → ${esc(l.to)}: ${l.lane_lead_days} day(s) · dispatch ${dlabIso(l.dispatch_date)} · arrive ${dlabIso(l.arrival_date)}</div>`).join('') : ''}
      ${lt.lead_days != null ? `<div class="formula">L_supplier = mean of past lead times ${r1(lt.mean_past_lead_days)}${lt.signal_delay_days ? ` + ${esc((lt.signals || []).join(', '))} ${lt.signal_delay_days}` : ''} = ${lt.lead_days} days · order ${dlabIso(lt.order_date)} · arrive ${dlabIso(lt.arrival_date)}</div>` : ''}
      ${lt.po_id ? `<div class="formula">${esc(lt.po_id)}: ETA ${dlabIso(lt.eta)}${lt.signal_delay_days ? ` + ${lt.signal_delay_days} d signal delay` : ''} · arrival ${dlabIso(lt.arrival_before)} → ${dlabIso(lt.arrival_after)}</div>` : ''}
      <h4>Formulas</h4>
      ${(R.formulas || []).map(f => `<div class="formula">${esc(f)}</div>`).join('')}
      ${(R.assumptions || []).map(a => `<div class="note" style="margin-top:6px">Assumption: ${esc(a)}</div>`).join('')}
      ${R.tested_under_tree_assumptions ? `<div class="note" style="margin-top:6px">Tested in the Lab under sandbox assumptions: ${esc(JSON.stringify(R.tested_under_tree_assumptions))}</div>` : ''}
      <div class="note mono" style="margin-top:14px;font-size:10.5px">Input hash ${esc(R.input_hash || d.input_hash)}</div>
    </div>
    <div class="stack span-5">
      <div class="doc rv" style="--d:.14s"><div class="dh"><div><span class="lbl">Staff instructions</span><h3>${esc(d.sku)} → ${esc(locName(d.location))}</h3></div>${d.status === 'Rejected' ? '<span class="pill Rejected">Not issued</span>' : d.status === 'Stale' ? '<span class="pill Stale">Hold</span>' : ''}</div>
        ${(R.staff_instructions || []).length ? R.staff_instructions.map((s, i) => `<div class="q-item" style="grid-template-columns:30px minmax(0,1fr)"><span class="n">${i+1}</span><div><div class="ss" style="color:var(--ink)">${esc(s)}</div></div></div>`).join('') : '<div class="empty">Wait for inbound: no staff action.</div>'}
        <div class="note" style="margin-top:10px">Decision support only. Inventra never executes transfers or sends purchase orders.</div>
        <div class="row" style="margin-top:14px"><button class="btn sm solid" onclick="downloadBrief(${jsq(d.decision_id)})">${IC.dl} Download (.md)</button><button class="btn sm" onclick="copyBrief(${jsq(d.decision_id)})">${IC.copy} Copy text</button></div>
      </div>
    </div>
  </div>`;
}
function briefText(d){
  const R = d.receipt || {};
  return `# Staff instructions ${d.decision_id}\n${d.sku} ${R.sku_name || ''} → ${locName(d.location)}\n${d.status} by ${d.approver}, ${tlab(d.timestamp)}\n\n` + ((R.staff_instructions || []).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'Wait for inbound: no staff action.') + `\n\nDecision support only. Generated by Inventra from fictional data. Input hash ${R.input_hash || d.input_hash}.`;
}
function decCached(id){ const b = LAZY.dec || {}; const k = Object.keys(b).find(x => x.startsWith(id + '#') && b[x] && b[x].decision_id); return k ? b[k] : null; }
function downloadBrief(id){ const d = decCached(id); if (d) download(`staff-instructions-${id}.md`, briefText(d)); }
function copyBrief(id){ const d = decCached(id); if (!d) return; const t = briefText(d); try { navigator.clipboard.writeText(t).then(() => toast('Copied'), () => fallbackCopy(t)); } catch (e) { fallbackCopy(t); } }
function fallbackCopy(t){ openModal(`<h3>Copy the instructions</h3><textarea id="cpT" rows="12" style="width:100%;margin-top:10px;font-family:var(--mono);font-size:12px;background:var(--surface);color:var(--ink);border:1px solid var(--line);padding:10px">${esc(t)}</textarea><div class="row" style="margin-top:10px"><button class="btn sm" onclick="closeModal()">Done</button></div>`); setTimeout(() => $('cpT').select(), 50); }
async function recalc(id){
  busy('Recalculating on the server…');
  try { RECALC[id] = await api(`/decisions/${encodeURIComponent(id)}/recalculate`, {method:'POST'}); }
  catch (e) { showError(e); }
  finally { unbusy(); render('decisions', true); }
}
function approveRecalc(id){
  const rc = RECALC[id], d = S.decisions.find(x => x.decision_id === id), o = rc.recommendation;
  const send = why => mutate('Approving the recalculated option…', async () => { const r = await api('/decisions', {method:'POST', body:{action:'approve', sku:d.sku, location:d.location, option_id:o.option_id, expected_input_hash:rc.current_input_hash, reason:why || null}}); DSELD = r.decision.decision_id; delete RECALC[id]; return r; });
  if (o.robustness === 'Fragile') return reasonModal('Approve a Fragile option', `${esc(o.label)} fails some demand and delay cases. A one-line reason is required.`, send);
  send(null);
}

/* ================= EVALUATION (E1 to E4) ================= */
let REVEALED = false;
function viewEvaluation(){
  if (!RP){
    const rep = lazy('report', 'last', () => api('/evaluation/report').catch(e => (e instanceof ApiError && e.status === 404) ? {none:true} : Promise.reject(e)));
    if (rep && !rep.none && !rep.error){ RP = rep; REVEALED = true; }
  }
  if (!RP) return secHead('evaluation') + `
  <div class="card rv" style="--d:.05s"><div class="row" style="justify-content:space-between;gap:20px"><div style="max-width:76ch"><h3>Replay rules</h3><div class="hint" style="margin-top:4px">Both arms plan on ${dlabIso(S.planDay)} from days 1 to 90. Days 91 to 120 are then revealed on the server and both plans run against true demand, true stock and the realised delays. The browser never sees the answer key, only the scored results.</div>
    <div class="tscroll" style="margin-top:12px"><table class="t ftable"><thead><tr><th>Rule</th><th>Inventra arm</th><th>Baseline arm</th></tr></thead><tbody>
      <tr><td>Forecast</td><td>Section 7 method</td><td>Average observed sales over the base window, uncorrected</td></tr>
      <tr><td>Approval</td><td>Every recommended option auto-approved on day 90; Fragile included, Harmful and rejected never</td><td>—</td></tr>
      <tr><td>Transfers</td><td>Executed on day 90, arriving after lane lead days</td><td>None</td></tr>
      <tr><td>Reorders</td><td>Placed on their order-by date</td><td>When free stock reaches safety stock; baseline days of average demand, rounded to MOQ</td></tr>
      <tr><td>Planning lead time</td><td>Supplier mean + likely signal delay</td><td>Supplier mean only</td></tr>
      <tr><td>Records</td><td>With logged corrections applied</td><td>Raw records</td></tr>
    </tbody></table></div><div class="note" style="margin-top:6px">Reorders arriving after day 120 are not credited in either arm. The replay plans once and does not re-plan mid-horizon. The 12-case answer-key checklist is scored with the replay.</div></div>
    <button class="btn acc" onclick="runReplay()">${IC.target} Reveal days 91–120</button></div></div>`;
  const b = RP.baseline, s = RP.inventra, fc = RP.forecast, cb = RP.constraint_breaches;
  const rows = [
    ['Forecast error (WAPE)', fc.wape.baseline*100, fc.wape.inventra*100, v => r1(v) + '%', 'Lower'],
    ['Forecast bias', fc.bias.baseline*100, fc.bias.inventra*100, v => (v > 0 ? '+' : '') + r1(v) + '%', 'Closer to 0'],
    ['Band calibration (P10 to P90)', null, fc.band_calibration*100, v => v == null ? '—' : Math.round(v) + '%', 'Near 80%'],
    ['Lost sales', b.lost_sales, s.lost_sales, fmt, 'Lower'],
    ['Buffer-breach days', b.buffer_breach_days, s.buffer_breach_days, fmt, 'Lower'],
    ['Excess units at day 120', b.excess_units_day120, s.excess_units_day120, fmt, 'Lower'],
    ['Aged stock value at day 120', b.aged_stock_value_day120_aed, s.aged_stock_value_day120_aed, aed, 'Lower'],
    ['Margin − transfer − expedite − holding − ageing', b.net_economic_aed, s.net_economic_aed, aed, 'Higher'],
    ['Constraint breaches', 0, cb.count, fmt, '0'],
    ['Explanation verification (first pass)', null, RP.explanation_verification == null ? null : RP.explanation_verification * 100, v => v == null ? 'keyless' : Math.round(v) + '%', '100%']
  ];
  const better = (bv, sv, how) => sv == null || bv == null || Math.abs(sv - bv) < 0.5 ? true : how === 'Lower' ? sv < bv : how === 'Higher' ? sv > bv : how === '0' ? sv === 0 : Math.abs(sv) < Math.abs(bv);
  const types = ['new_safety_stock_breach','reserved_or_unavailable_stock_moved','infeasible_lead_time'];
  const tl = {new_safety_stock_breach:'New safety-stock breach caused by an action', reserved_or_unavailable_stock_moved:'Reserved stock moved', infeasible_lead_time:'Infeasible lead time'};
  const ck = RP.checklist || [];
  return secHead('evaluation') + `
  <div class="kstrip rv reveal" style="--d:.02s;grid-template-columns:repeat(4,minmax(0,1fr))">${REVEALED ? '' : '<span class="curtain"></span>'}
    <div class="kc hero"><span class="lbl">Net economic benefit vs baseline</span><div class="ba"><span class="now">${aed(RP.net_benefit_vs_baseline_aed)}</span></div><div class="dl">30 hidden days, fictional prices</div></div>
    <div class="kc"><span class="lbl">Lost sales</span><div class="ba"><span class="now">${fmt(s.lost_sales)}</span><span class="was">${fmt(b.lost_sales)}</span></div><div class="dl ${s.lost_sales <= b.lost_sales ? 'up' : 'down'}">${fmt(Math.abs(b.lost_sales - s.lost_sales))} ${s.lost_sales <= b.lost_sales ? 'fewer' : 'more'} than baseline</div></div>
    <div class="kc"><span class="lbl">Constraint breaches</span><div class="ba"><span class="now">${cb.count}</span></div><div class="dl ${cb.count ? 'down' : 'up'}">target zero · verdict ${esc(RP.verdict)}</div></div>
    <div class="kc"><span class="lbl">Band calibration</span><div class="ba"><span class="now">${Math.round(fc.band_calibration*100)}%</span></div><div class="dl">target about 80%</div></div>
  </div>
  <div class="grid">
    <div class="card span-8 rv reveal" style="--d:.08s">${REVEALED ? '' : '<span class="curtain" style="animation-delay:.15s"></span>'}<div class="card-h"><div><h3>Baseline vs Inventra</h3><div class="hint">Same true demand and realised disruptions. ${RP.auto_approved_options} recommended options auto-approved for the Inventra arm.</div></div><div class="legend"><span><i style="background:var(--faint)"></i>Baseline</span><span><i style="background:var(--ink)"></i>Inventra</span></div></div>
      <div class="ev-row" style="padding-top:0"><span class="lbl">Metric</span><span class="lbl">Baseline</span><span class="lbl">Inventra</span><span class="lbl">Better when</span></div>
      ${rows.map(([n, bv, sv, f, how]) => { const mx = Math.max(Math.abs(bv || 0), Math.abs(sv || 0)) || 1; const ok = better(bv, sv, how); return `<div class="ev-row"><span>${n}</span><span class="bx">${bv == null ? '<span class="muted">—</span>' : `<i style="width:${Math.abs(bv)/mx*60}px;background:var(--faint)"></i><span class="muted">${f(bv)}</span>`}</span><span class="bx">${sv == null ? `<span class="muted">${f(null)}</span>` : `<i style="width:${Math.abs(sv)/mx*60}px;background:var(--ink)"></i><b>${f(sv)}</b>${ok ? '' : ' <span class="tag warn">worse</span>'}`}</span><span class="muted">${how}</span></div>`; }).join('')}
      <div class="note" style="margin-top:12px">Prices, margins, holding and ageing rates are fictional, so units are the primary measure. A larger saving with any constraint breach is reported as a failure.</div>
    </div>
    <div class="stack span-4">
      <div class="card rv" style="--d:.12s"><h3>Constraint compliance</h3><div class="hint" style="margin-bottom:8px">Target zero.</div>
        ${types.map(t => { const v = cb.items.filter(x => x.type === t).length; return `<div class="chk"><span class="bx ${v ? 'n' : 'y'}">${v ? '✕' : '✓'}</span><span>${tl[t]}</span><b>${v}</b></div>`; }).join('')}</div>
      <div class="card rv" style="--d:.16s"><h3>Cost lines</h3><div class="hint" style="margin-bottom:8px">Inventra vs baseline over the 30 hidden days.</div>
        <div class="kv"><dt>Transfers</dt><dd>${aed(s.transfer_cost_aed)} vs ${aed(b.transfer_cost_aed)}</dd><dt>Expedite</dt><dd>${aed(s.expedite_cost_aed)} vs ${aed(b.expedite_cost_aed)}</dd><dt>Holding</dt><dd>${aed(s.holding_cost_aed)} vs ${aed(b.holding_cost_aed)}</dd><dt>Ageing</dt><dd>${aed(s.ageing_cost_aed)} vs ${aed(b.ageing_cost_aed)}</dd></div></div>
    </div>
  </div>
  <div class="card rv" style="--d:.2s;margin-top:14px"><div class="card-h"><div><h3>Answer-key checklist · evaluation_checklist_v1</h3><div class="hint">Each injected case marked handled or missed by the server against the current engine run. Some cases need their demo step first (drop SIG-001, approve, then correct the cycle count).</div></div><span class="tag ${ck.every(x => x.result === 'handled') ? 'ok' : 'warn'}">${ck.filter(x => x.result === 'handled').length} / ${ck.length} handled</span></div>
    ${ck.map(c => `<div class="chk"><span class="bx ${c.result === 'handled' ? 'y' : 'n'}">${c.result === 'handled' ? '✓' : '✕'}</span><div><b>${c.case_id}. ${esc(c.description)}</b><div class="muted" style="font-size:12px">Expected: ${esc(c.expected_action)} · Got: ${esc(c.evidence)}</div></div><span class="tag ${c.result === 'handled' ? 'ok' : 'bad'}">${c.result === 'handled' ? 'Handled' : 'Missed'}</span></div>`).join('')}</div>
  <div class="row" style="justify-content:center;margin-top:14px"><button class="btn sm" onclick="runReplay()">${IC.loop} Run the replay again</button><button class="btn sm" onclick="RP=null;REVEALED=false;LAZY.report={'last':{none:true}};render('evaluation')">Hide actuals again</button></div>`;
}
RENDER.evaluation = viewEvaluation;
async function runReplay(){
  busy('Replaying days 91 to 120 on the server…');
  try { RP = await api('/evaluation/replay', {method:'POST'}); REVEALED = false; render('evaluation'); setTimeout(() => { REVEALED = true; }, 1400); refreshChrome(); }
  catch (e) { showError(e); }
  finally { unbusy(); }
}

/* ================= INVENTRA DRAWER: what-if and explanations ================= */
const CHIPS_K = ['What if we also reorder 50 power banks for Abu Dhabi?', 'What if we move 60 USB-C 20W chargers from Sharjah to Abu Dhabi?', 'Explain the top recommendation'];
const CHIPS_L = ['Explain the top recommendation', 'Explain CHG-01 in Abu Dhabi', 'Explain CBL-02 in Abu Dhabi'];
function renderChips(){ $('drChips').innerHTML = (keyed() ? CHIPS_K : CHIPS_L).map(c => `<button onclick="ask(this.textContent)">${esc(c)}</button>`).join(''); }
function syncPilotMode(){
  document.querySelectorAll('#modeSeg button').forEach(b => { b.classList.toggle('on', b.dataset.m === (keyed() ? 'live' : 'local')); if (b.dataset.m === 'live') b.disabled = !serverKeyed(); });
  const inp = $('drInp'), note = $('drKeyless'); if (!inp) return;
  inp.style.display = keyed() ? '' : 'none'; note.style.display = keyed() ? 'none' : '';
  renderChips();
}
function setMode(m){ if (m === 'live' && !serverKeyed()) return; LOCAL_KEYLESS = m === 'local'; try { localStorage.setItem('inventra-keyless', LOCAL_KEYLESS ? '1' : '0'); } catch (e) {} refreshChrome(); render(CURRENT, true); }
function openPilot(q){
  $('drawer').classList.add('open'); $('scrim').classList.add('on');
  syncPilotMode();
  if (!$('chat').children.length) addBub('g', {html:`Hello ${esc(plannerName())}. I have two jobs. I explain computed results, citing every figure so it can be checked. When the backend has an LLM key I also turn a typed what-if into scenario-builder fields for you to check and run. I never compute a number, run a scenario or choose which decision to test.`});
  if (q && q.trim()) ask(q); else setTimeout(() => { if (keyed()) $('q').focus(); }, 350);
}
function closePilot(){ $('drawer').classList.remove('open'); $('scrim').classList.remove('on'); }
function addBub(role, o){ const c = $('chat'), d = document.createElement('div'); d.className = 'bub ' + (role === 'u' ? 'u' : 'g'); if (o.text !== undefined) d.textContent = o.text; else d.innerHTML = o.html; c.appendChild(d); c.scrollTop = c.scrollHeight; return d; }
async function ask(q){
  if (!q || !q.trim()) return;
  addBub('u', {text:q}); $('q').value = '';
  const bub = addBub('g', {html:'<span class="typing"><span></span><span></span><span></span></span>'});
  if (/^\s*(explain|why)/i.test(q) || !keyed()){
    const code = (q.match(/\b[A-Z]{3}-\d{2}\b/i) || [])[0], loc = /abu dhabi|auh/i.test(q) ? 'Abu Dhabi' : /sharjah|shj/i.test(q) ? 'Sharjah' : /dubai|dxb/i.test(q) ? 'Dubai' : null;
    const withTop = RECS.filter(x => x.top);
    const r = code ? (withTop.find(x => x.sku === code.toUpperCase() && (!loc || x.loc === loc)) || withTop.find(x => x.sku === code.toUpperCase())) : withTop[0];
    if (!r){
      const dk = code && key(code.toUpperCase(), loc || ''), dec = dk && ['Approved','Overridden'].includes((activeDecision(dk) || {}).status) ? activeDecision(dk) : null;
      bub.innerHTML = dec ? `${esc(code.toUpperCase())} in ${esc(locName(loc))} already has an approved decision (${esc(dec.decision_id)}: ${esc(dec.chosen.label)}). Its receipt lists the inputs, checks and reasons.<button class="bact" onclick="closePilot();openDecision(${jsq(dec.decision_id)})">Open the receipt</button>`
        : 'That is not in the data: no open recommendation exists for that SKU and location.';
      return;
    }
    try {
      const x = await api(`/explain/recommendation?sku=${encodeURIComponent(r.sku)}&location=${encodeURIComponent(r.loc)}`);
      bub.innerHTML = `<div style="margin-bottom:6px"><b>${esc(r.sku)} → ${esc(locName(r.loc))}</b></div>` + explainHTML(x) + `<button class="bact" onclick="openLab(${jsq(r.key)})">Open ${esc(r.sku)} → ${esc(locName(r.loc))} in the Lab</button>`;
    } catch (e) { bub.innerHTML = esc(errMsg(e)); }
    $('chat').scrollTop = $('chat').scrollHeight; return;
  }
  await askWhatIf(q);
  const b = LAB.b;
  bub.innerHTML = LAB.filled ? `Filled the scenario builder. Nothing has run.<table>${Object.entries({decision:b.type, from:b.from, to:b.to, for:b.type === 'reorder' ? b.location : null, units:b.qty, order:b.po_id, days:b.days, 'new qty':b.new_qty}).filter(([k, v]) => v != null && v !== '').map(([k, v]) => `<tr><td>${k}</td><td><b>${esc(v)}</b></td></tr>`).join('')}</table><button class="bact" onclick="closePilot();go('lab')">Check and run in the Lab</button>` : (LAB.msg ? LAB.msg.text : 'No answer.');
  $('chat').scrollTop = $('chat').scrollHeight;
}

/* ================= RESET + BOOT ================= */
function resetDemo(){ openModal(`<h3>Reset the demo</h3><div class="hint">Reloads the seeded dataset on the server and clears inbox events, corrections, signal edits, decision trees and decisions.</div><div class="row" style="margin-top:14px"><button class="btn sm solid" onclick="doReset()">Reset</button><button class="btn sm" onclick="closeModal()">Cancel</button></div>`); }
async function doReset(){
  closeModal(); busy('Reloading the seeded dataset…');
  try {
    await api('/reset', {method:'POST'});
    TREES = {}; saveTrees(); ANSWERED = {}; try { localStorage.setItem('inventra-answered', '{}'); } catch (e) {}
    LAB = {key:null, tree:null, treeAt:null, sel:null, cmp:[], b:{type:'transfer'}, msg:null, qbusy:false, filled:false, question:null, parsedAssumptions:null, bp:{}, loading:false};
    DSELD = null; RP = null; RECALC = {};
    await loadAll(); refreshChrome(); go('home'); toast('Seeded dataset reloaded');
  } catch (e) { showError(e); }
  finally { unbusy(); }
}
document.addEventListener('keydown', e => {
  if (!$('intro').classList.contains('gone')) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === '/' && !typing){ e.preventDefault(); openPilot(); }
  if (e.key === 'Escape'){ closePilot(); closeModal(); }
});
function setTheme(t){
  const dark = t === 'dark';
  if (dark) document.documentElement.setAttribute('data-sp', 'dark'); else document.documentElement.removeAttribute('data-sp');
  const b = $('themeBtn'); if (b){ b.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode'); b.title = dark ? 'Light mode' : 'Dark mode'; }
}
function toggleTheme(){ const t = document.documentElement.getAttribute('data-sp') === 'dark' ? 'light' : 'dark'; setTheme(t); try { localStorage.setItem('inventra-theme', t); } catch (e) {} }
let POLL = null;
async function boot(){
  try {
    busy('Loading the plan from the Inventra API…');
    await loadAll();
    hideApiDown();
    refreshChrome();
    const h = location.hash.slice(1); go(ORDER.includes(h) ? h : CURRENT);
    if (!POLL) POLL = setInterval(pollEvents, 6000);
  } catch (e) { if (!(e instanceof ApiError && e.status === 0)) { showApiDown(); $('apiDown').querySelector('span').textContent = errMsg(e); } }
  finally { unbusy(); }
}
function init(){
  try { setTheme(localStorage.getItem('inventra-theme') || 'light'); } catch (e) { setTheme('light'); }
  renderDock(); renderWhere();
  $('qSend').innerHTML = IC.send;
  $('bell').insertAdjacentHTML('afterbegin', IC.bell);
  boot();
}
init();
$('app').addEventListener('animationend', e => { if (e.target === $('app')) $('app').classList.remove('enter'); });
