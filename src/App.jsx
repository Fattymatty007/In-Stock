import { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, X, Trash2, ChevronLeft, ChevronRight, ChevronDown, AlertTriangle, CheckCircle2,
  Package, ShoppingBag, CalendarDays, Receipt, Share2, ClipboardList, Pencil, Save, LogOut, Download,
} from 'lucide-react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from './firebase';
import { subscribeUserData, saveUserData, loadLocalData, saveLocalData } from './dataStore';
import { signInWithGoogle, signOutUser } from './auth';

/* ---------- constants ---------- */

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const BG_COLOR = '#F6F5EF';
const BODY_FONT = "'Manrope', ui-sans-serif, system-ui, sans-serif";
const monoStyle = { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontVariantNumeric: 'tabular-nums' };
const inputCls =
  'w-full rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-stone-900 ' +
  'placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-green-100 focus:border-green-700';

/* ---------- helpers ---------- */

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + d;
}

function formatDateLabel(dateKey) {
  const parts = dateKey.split('-').map(Number);
  const date = new Date(parts[0], parts[1] - 1, parts[2]);
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function currency(n) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/* ---------- inventory / unit helpers ---------- */

function stockOf(item) {
  return item.available - item.sold;
}

// Converts a quantity typed in the item's chosen unit (boxes or singles) into base singles.
function toBaseQty(displayQty, unitType, unitsPerBox) {
  const n = Math.max(0, Math.round(Number(displayQty) || 0));
  if (unitType === 'boxes') {
    const perBox = Math.max(1, Math.round(Number(unitsPerBox) || 1));
    return n * perBox;
  }
  return n;
}

// A small "3 boxes" style caption for a base-singles quantity, or null if not box-tracked.
function boxHint(qty, item) {
  if (item.unitType !== 'boxes' || !(Number(item.unitsPerBox) > 0)) return null;
  if (qty <= 0) return null;
  const perBox = Number(item.unitsPerBox);
  const boxes = Math.floor(qty / perBox);
  const remainder = qty % perBox;
  if (boxes === 0) return remainder + ' units (less than 1 box)';
  const boxLabel = boxes + (boxes === 1 ? ' box' : ' boxes');
  return remainder === 0 ? boxLabel : boxLabel + ' + ' + remainder;
}

// Formats a "how much to order" quantity, rounding up to whole boxes when box-tracked.
function formatOrderQty(needed, item) {
  const n = Math.max(0, Math.round(needed));
  if (item.unitType === 'boxes' && Number(item.unitsPerBox) > 0) {
    const perBox = Number(item.unitsPerBox);
    const boxes = Math.max(1, Math.ceil(n / perBox));
    return boxes + (boxes === 1 ? ' box' : ' boxes') + ' (' + (boxes * perBox) + ' units)';
  }
  return n + (n === 1 ? ' unit' : ' units');
}

// Formats an exact known quantity (no rounding up) in the item's unit, e.g. "2 boxes + 5 (53 units)".
function formatExactQty(qty, item) {
  const n = Math.max(0, Math.round(qty));
  if (item.unitType === 'boxes' && Number(item.unitsPerBox) > 0) {
    const perBox = Number(item.unitsPerBox);
    const boxes = Math.floor(n / perBox);
    const remainder = n % perBox;
    const boxLabel = boxes + (boxes === 1 ? ' box' : ' boxes');
    return remainder === 0 ? boxLabel + ' (' + n + ' units)' : boxLabel + ' + ' + remainder + ' (' + n + ' units)';
  }
  return n + (n === 1 ? ' unit' : ' units');
}

function buildPurchaseListText(lowStockItems) {
  const dateLabel = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  if (lowStockItems.length === 0) {
    return 'Purchase List (' + dateLabel + ')\n\nNothing needs ordering right now.';
  }
  const lines = lowStockItems.map((item) => {
    const needed = Math.max(item.max, item.min) - stockOf(item);
    return '- ' + item.name + ': order ' + formatOrderQty(needed, item);
  });
  return 'Purchase List (' + dateLabel + ')\n\n' + lines.join('\n');
}

function buildSalesDaySummaryText(day, rows, totalCost, totalRevenue, profit, extraCosts) {
  const lines = rows.map(({ entry, item }) => {
    return (
      '- ' + item.name + ': started ' + formatExactQty(entry.qtyOut, item) +
      ', remaining ' + formatExactQty(entry.remaining || 0, item) +
      ', sold ' + formatExactQty(entry.sold || 0, item)
    );
  });
  const extraLines = (extraCosts || []).map((c) => '- ' + c.label + ': ' + currency(c.amount));
  return (
    'Sales Day \u2014 ' + formatDateLabel(day.date) + '\n\n' +
    lines.join('\n') + '\n\n' +
    (extraLines.length > 0 ? 'Additional costs:\n' + extraLines.join('\n') + '\n\n' : '') +
    'Cost: ' + currency(totalCost) + '\n' +
    'Revenue: ' + currency(totalRevenue) + '\n' +
    'Profit: ' + currency(profit)
  );
}

// Brings older saved items (pre unit-of-measure / tally update) up to the current shape.
function migrateItem(raw) {
  const unitType = raw.unitType === 'boxes' ? 'boxes' : 'singles';
  const unitsPerBox = unitType === 'boxes' ? Math.max(1, Math.round(Number(raw.unitsPerBox) || 1)) : 1;
  const available = raw.available !== undefined ? raw.available : (raw.stock !== undefined ? raw.stock : 0);
  return {
    id: raw.id || generateId(),
    name: raw.name || '',
    available: Math.max(0, Math.round(Number(available) || 0)),
    sold: Math.max(0, Math.round(Number(raw.sold) || 0)),
    min: Math.max(0, Math.round(Number(raw.min) || 0)),
    max: Math.max(0, Math.round(Number(raw.max) || 0)),
    cost: Math.max(0, Number(raw.cost) || 0),
    salePrice: Math.max(0, Number(raw.salePrice) || 0),
    unitType,
    unitsPerBox,
  };
}

// Migrates a whole saved/restored array, skipping any single malformed entry instead of
// letting one bad item wipe out the entire list.
function migrateItems(rawArray) {
  if (!Array.isArray(rawArray)) return [];
  const result = [];
  for (const raw of rawArray) {
    try {
      if (raw && typeof raw === 'object') result.push(migrateItem(raw));
    } catch (e) { /* skip this one, keep the rest */ }
  }
  return result;
}

/* ---------- small shared pieces ---------- */

function ModalShell({ onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ backgroundColor: 'rgba(23, 26, 21, 0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-6 overflow-y-auto select-none"
        style={{ maxHeight: '85vh', WebkitTouchCallout: 'none' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

// Tracks whether a text-entry element is currently focused anywhere in the app (including
// inside modals — this listens at the document level, so no prop drilling needed) and exposes
// a way to blur it, which dismisses the on-screen keyboard on mobile.
function useActiveTextInput() {
  const [visible, setVisible] = useState(false);
  const activeRef = useRef(null);

  useEffect(() => {
    function isTextInput(el) {
      if (!el) return false;
      if (el.tagName === 'TEXTAREA') return true;
      if (el.tagName === 'INPUT') {
        const type = (el.type || 'text').toLowerCase();
        return ['text', 'number', 'email', 'tel', 'url', 'search', 'password', 'date'].includes(type);
      }
      return false;
    }
    let hideTimer = null;
    function onFocusIn(e) {
      if (!isTextInput(e.target)) return;
      clearTimeout(hideTimer);
      activeRef.current = e.target;
      setVisible(true);
    }
    function onFocusOut(e) {
      if (!isTextInput(e.target)) return;
      // Small delay so tabbing straight from one text input to another doesn't flicker the button.
      hideTimer = setTimeout(() => setVisible(false), 80);
    }
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      clearTimeout(hideTimer);
    };
  }, []);

  return { visible, dismiss: () => activeRef.current?.blur() };
}

// Floating button that sits just above the on-screen keyboard (tracked via the Visual Viewport
// API, since the keyboard shrinks that but not the layout viewport) and hides it on tap.
function KeyboardDismissButton({ visible, onDismiss }) {
  const [bottomOffset, setBottomOffset] = useState(8);

  useEffect(() => {
    if (!visible) return undefined;
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    function update() {
      if (!vv) return;
      setBottomOffset(Math.max(window.innerHeight - (vv.height + vv.offsetTop), 0) + 8);
    }
    update();
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
    };
  }, [visible]);

  if (!visible) return null;

  return (
    <button
      onClick={onDismiss}
      aria-label="Hide keyboard"
      className="fixed right-3 z-50 flex items-center justify-center w-9 h-9 rounded-full shadow-lg bg-stone-900 text-white"
      style={{ bottom: bottomOffset }}
    >
      <ChevronDown size={18} />
    </button>
  );
}

// Fires onLongPress after `ms` of press-and-hold; otherwise fires onClick as a normal tap.
function useLongPress(onLongPress, onClick, ms = 500) {
  const timerRef = useRef(null);
  const firedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  function start() {
    firedRef.current = false;
    setPressing(true);
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      setPressing(false);
      onLongPress();
    }, ms);
  }
  function clear() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    setPressing(false);
  }
  function handleClick(e) {
    if (firedRef.current) {
      e.preventDefault();
      e.stopPropagation();
      firedRef.current = false;
      return;
    }
    clear();
    onClick(e);
  }

  return {
    pressing,
    handlers: {
      onMouseDown: start,
      onMouseUp: clear,
      onMouseLeave: clear,
      onTouchStart: start,
      onTouchEnd: clear,
      onTouchMove: clear,
      onTouchCancel: clear,
      onClick: handleClick,
      onContextMenu: (e) => e.preventDefault(),
    },
  };
}

// A horizontal slider the user must drag all the way across to confirm a destructive action.
function SlideToConfirm({ label, onConfirm }) {
  const trackRef = useRef(null);
  const confirmedRef = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const HANDLE = 40;

  function clientX(e) {
    if (e.touches && e.touches[0]) return e.touches[0].clientX;
    if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].clientX;
    return e.clientX;
  }

  function updateFromClientX(x) {
    if (confirmedRef.current) return;
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const maxX = Math.max(1, rect.width - HANDLE);
    const relative = x - rect.left - HANDLE / 2;
    const clamped = Math.max(0, Math.min(maxX, relative));
    setDragX(clamped);
    if (clamped >= maxX - 4) {
      confirmedRef.current = true;
      setConfirmed(true);
      setDragging(false);
      onConfirm();
    }
  }

  function handleStart() {
    if (confirmedRef.current) return;
    setDragging(true);
  }

  useEffect(() => {
    if (!dragging) return;
    function onMove(e) { updateFromClientX(clientX(e)); }
    function onUp() {
      setDragging(false);
      if (!confirmedRef.current) setDragX(0);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging]);

  return (
    <div
      ref={trackRef}
      className="relative w-full h-12 rounded-full bg-rose-50 border border-rose-200 select-none overflow-hidden"
    >
      <div className="absolute inset-y-0 left-0 bg-rose-100 rounded-full" style={{ width: (dragX + HANDLE) + 'px' }} />
      <p className="absolute inset-0 flex items-center justify-center text-sm font-medium text-rose-600 pointer-events-none">
        {confirmed ? 'Deleting…' : label}
      </p>
      <div
        onMouseDown={handleStart}
        onTouchStart={handleStart}
        className="absolute top-1 left-1 rounded-full bg-rose-600 flex items-center justify-center text-white"
        style={{
          width: HANDLE + 'px',
          height: HANDLE + 'px',
          transform: 'translateX(' + dragX + 'px)',
          transition: dragging ? 'none' : 'transform 0.2s ease',
        }}
      >
        <Trash2 size={16} />
      </div>
    </div>
  );
}

function Stat({ label, value, tone }) {
  const color = tone === 'negative' ? 'text-rose-600' : tone === 'positive' ? 'text-green-800' : 'text-stone-900';
  return (
    <div className="bg-stone-50 rounded-xl py-2.5 px-1 text-center">
      <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-1">{label}</p>
      <p className={'text-lg font-semibold ' + color} style={monoStyle}>{value}</p>
    </div>
  );
}

function EmptyState({ icon: Icon, text }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 px-6">
      <div className="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center mb-3">
        <Icon size={24} className="text-stone-400" />
      </div>
      <p className="text-sm text-stone-500 max-w-xs">{text}</p>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: BG_COLOR }}>
      <div className="w-8 h-8 border-2 border-stone-200 border-t-green-800 rounded-full animate-spin" />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.92c1.7-1.57 2.68-3.87 2.68-6.61z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.59-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

function EventRow({ event, onClick, showDate }) {
  const isExpense = event.type === 'expense';
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 bg-white rounded-xl border border-stone-200 p-3 text-left hover:border-stone-300 transition-colors"
    >
      <div
        className={
          'w-9 h-9 rounded-full flex items-center justify-center shrink-0 ' +
          (isExpense ? 'bg-amber-50 text-amber-700' : 'bg-sky-50 text-sky-700')
        }
      >
        {isExpense ? <Receipt size={16} /> : <CalendarDays size={16} />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-stone-900 truncate">{event.title}</p>
        {showDate && <p className="text-xs text-stone-400 mt-0.5">{formatDateLabel(event.date)}</p>}
        {event.notes && <p className="text-xs text-stone-400 truncate mt-0.5">{event.notes}</p>}
      </div>
      {isExpense && (
        <p className="font-semibold text-stone-900 shrink-0" style={monoStyle}>{currency(event.amount)}</p>
      )}
    </button>
  );
}

/* ---------- item modals ---------- */

function ItemEditModal({ item, onClose, onSave, onDelete = () => {} }) {
  const isNew = !item;
  const [name, setName] = useState(item ? item.name : '');
  const [unitType, setUnitType] = useState(item ? item.unitType : 'singles');
  const [unitsPerBox, setUnitsPerBox] = useState(item && item.unitsPerBox ? String(item.unitsPerBox) : '');
  const [qtyInput, setQtyInput] = useState('');
  const [cost, setCost] = useState(item ? String(item.cost || 0) : '');
  const [salePrice, setSalePrice] = useState(item ? String(item.salePrice || 0) : '');
  const [min, setMin] = useState(item ? String(item.min) : '');
  const [max, setMax] = useState(item ? String(item.max) : '');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const currentStock = item ? stockOf(item) : 0;
  const hint = item ? boxHint(currentStock, { unitType, unitsPerBox: Number(unitsPerBox) || 0 }) : null;

  function handleSave() {
    if (!name.trim()) {
      setError('Enter an item name.');
      return;
    }
    if (unitType === 'boxes' && !(Number(unitsPerBox) > 0)) {
      setError('Enter how many come in a box.');
      return;
    }
    const addedBase = toBaseQty(qtyInput, unitType, unitsPerBox);
    const finalAvailable = isNew ? addedBase : item.available + addedBase;

    onSave({
      id: item ? item.id : generateId(),
      name: name.trim(),
      available: finalAvailable,
      sold: item ? item.sold : 0,
      min: Math.max(0, Math.round(Number(min) || 0)),
      max: Math.max(0, Math.round(Number(max) || 0)),
      cost: Math.max(0, Number(cost) || 0),
      salePrice: Math.max(0, Number(salePrice) || 0),
      unitType,
      unitsPerBox: unitType === 'boxes' ? Math.max(1, Math.round(Number(unitsPerBox) || 1)) : 1,
    });
    onClose();
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-stone-900">{isNew ? 'Add item' : 'Edit item'}</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">ITEM NAME</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blue T-Shirt" className={inputCls} />
        </div>

        {!isNew && (
          <div className="bg-stone-50 rounded-xl p-3.5">
            <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-1">Current stock</p>
            <p className="text-2xl font-semibold text-stone-900" style={monoStyle}>{currentStock}</p>
            {hint && <p className="text-xs text-stone-400 mt-0.5">{hint}</p>}
            <p className="text-xs text-stone-400 mt-2">{item.sold} sold all-time</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">UNIT OF MEASURE</label>
          <div className="flex gap-2">
            <button
              onClick={() => setUnitType('singles')}
              className={
                'flex-1 py-2.5 rounded-xl text-sm font-medium border ' +
                (unitType === 'singles' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'border-stone-200 text-stone-500')
              }
            >
              Singles
            </button>
            <button
              onClick={() => setUnitType('boxes')}
              className={
                'flex-1 py-2.5 rounded-xl text-sm font-medium border ' +
                (unitType === 'boxes' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'border-stone-200 text-stone-500')
              }
            >
              Boxes
            </button>
          </div>
        </div>

        {unitType === 'boxes' && (
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">UNITS PER BOX</label>
            <input
              type="number" inputMode="numeric" min="1"
              value={unitsPerBox} onChange={(e) => setUnitsPerBox(e.target.value)}
              placeholder="e.g. 24" className={inputCls} style={monoStyle}
            />
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">
            {isNew ? 'STARTING STOCK' : 'ADD TO STOCK'} {unitType === 'boxes' ? '(BOXES)' : '(UNITS)'}
          </label>
          <input
            type="number" inputMode="numeric" min="0"
            value={qtyInput} onChange={(e) => setQtyInput(e.target.value)}
            placeholder="0" className={inputCls} style={monoStyle}
          />
          {unitType === 'boxes' && qtyInput && Number(unitsPerBox) > 0 && (
            <p className="text-xs text-stone-400 mt-1.5">= {toBaseQty(qtyInput, unitType, unitsPerBox)} units</p>
          )}
          {!isNew && <p className="text-xs text-stone-400 mt-1.5">Leave at 0 if you're not restocking.</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">COST ($)</label>
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={cost} onChange={(e) => setCost(e.target.value)}
              placeholder="0.00" className={inputCls} style={monoStyle}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">SALE PRICE ($)</label>
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={salePrice} onChange={(e) => setSalePrice(e.target.value)}
              placeholder="0.00" className={inputCls} style={monoStyle}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">MIN (UNITS)</label>
            <input type="number" inputMode="numeric" min="0" value={min} onChange={(e) => setMin(e.target.value)} placeholder="0" className={inputCls} style={monoStyle} />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">MAX (UNITS)</label>
            <input type="number" inputMode="numeric" min="0" value={max} onChange={(e) => setMax(e.target.value)} placeholder="0" className={inputCls} style={monoStyle} />
          </div>
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      <div className="flex gap-2 mt-6">
        {!isNew && !confirmDelete && (
          <button onClick={() => setConfirmDelete(true)} aria-label="Delete item" className="p-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 shrink-0">
            <Trash2 size={18} />
          </button>
        )}
        {!isNew && confirmDelete && (
          <button
            onClick={() => { onDelete(item.id); onClose(); }}
            className="px-3 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-medium shrink-0"
          >
            Confirm delete
          </button>
        )}
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-700 font-medium hover:bg-stone-50">
          Cancel
        </button>
        <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
          Save
        </button>
      </div>
    </ModalShell>
  );
}

function AddMultipleModal({ onClose, onSaveMultiple }) {
  const [rows, setRows] = useState(() => [
    { id: generateId(), name: '', qty: '' },
    { id: generateId(), name: '', qty: '' },
    { id: generateId(), name: '', qty: '' },
  ]);
  const [error, setError] = useState('');

  function updateRow(id, field, value) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  }

  function addRow() {
    setRows((r) => [...r, { id: generateId(), name: '', qty: '' }]);
  }

  function removeRow(id) {
    setRows((r) => r.filter((row) => row.id !== id));
  }

  const validRows = rows.filter((r) => r.name.trim());

  function handleSave() {
    if (validRows.length === 0) {
      setError('Enter a name for at least one item.');
      return;
    }
    const newItems = validRows.map((r) => ({
      id: generateId(),
      name: r.name.trim(),
      available: Math.max(0, Math.round(Number(r.qty) || 0)),
      sold: 0,
      min: 0,
      max: 0,
      cost: 0,
      salePrice: 0,
      unitType: 'singles',
      unitsPerBox: 1,
    }));
    onSaveMultiple(newItems);
    onClose();
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-stone-900">Add multiple items</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>
      <p className="text-sm text-stone-500 mb-4">
        Quick entry with just a name and starting count. Set units, pricing, and thresholds for each afterward.
      </p>

      <div className="space-y-2 mb-3">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-2">
            <input
              value={row.name}
              onChange={(e) => updateRow(row.id, 'name', e.target.value)}
              placeholder="Item name"
              className={inputCls}
            />
            <input
              type="number" inputMode="numeric" min="0"
              value={row.qty}
              onChange={(e) => updateRow(row.id, 'qty', e.target.value)}
              placeholder="Qty"
              className="w-20 shrink-0 rounded-xl border border-stone-200 bg-white px-2 py-2.5 text-stone-900 text-center focus:outline-none focus:ring-2 focus:ring-green-100 focus:border-green-700"
              style={monoStyle}
            />
            <button
              onClick={() => removeRow(row.id)}
              aria-label="Remove row"
              className="p-2 rounded-full hover:bg-stone-100 text-stone-400 shrink-0"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      <button
        onClick={addRow}
        className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-stone-300 text-stone-500 text-sm font-medium hover:bg-stone-50 mb-4"
      >
        <Plus size={15} /> Add another row
      </button>

      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

      <div className="flex gap-2">
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-700 font-medium hover:bg-stone-50">
          Cancel
        </button>
        <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
          {validRows.length > 0 ? 'Add ' + validRows.length + ' item' + (validRows.length === 1 ? '' : 's') : 'Add items'}
        </button>
      </div>
    </ModalShell>
  );
}

function PurchaseListModal({ items, onClose }) {
  const lowStockItems = items.filter((i) => stockOf(i) < i.min).sort((a, b) => a.name.localeCompare(b.name));
  const listText = buildPurchaseListText(lowStockItems);
  const [copyState, setCopyState] = useState('idle');

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(listText);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (e) {
      setCopyState('error');
    }
  }

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Purchase List', text: listText });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    handleCopy();
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-stone-900">Purchase list</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>

      {lowStockItems.length === 0 ? (
        <p className="text-sm text-stone-500 py-6 text-center">Nothing needs ordering right now.</p>
      ) : (
        <>
          <div className="space-y-2 mb-5">
            {lowStockItems.map((item) => (
              <div key={item.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-3.5 py-2.5">
                <span className="text-sm font-medium text-stone-900 truncate mr-2">{item.name}</span>
                <span className="text-sm text-stone-600 shrink-0" style={monoStyle}>
                  {formatOrderQty(Math.max(item.max, item.min) - stockOf(item), item)}
                </span>
              </div>
            ))}
          </div>

          <button
            onClick={handleShare}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900 mb-3"
          >
            <Share2 size={16} /> {copyState === 'copied' ? 'Copied to clipboard' : 'Share purchase list'}
          </button>

          <textarea
            readOnly
            value={listText}
            onClick={(e) => e.target.select()}
            rows={Math.min(8, lowStockItems.length + 2)}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 resize-none"
            style={monoStyle}
          />
          <p className="text-xs text-stone-400 mt-1.5">Tap the text above to select it if sharing doesn't open.</p>
        </>
      )}
    </ModalShell>
  );
}

/* ---------- sales day modals ---------- */

function SalesDayFormModal({ day, items, onClose, onSave }) {
  const isNew = !day;
  const locked = !!day && day.status === 'completed';
  const [date, setDate] = useState(() => (day ? day.date : toDateKey(new Date())));
  const [selected, setSelected] = useState(() =>
    day ? day.items.map((e) => ({ itemId: e.itemId, qtyOut: e.qtyOut })) : []
  );
  const [pendingItem, setPendingItem] = useState(null);
  const [pendingQty, setPendingQty] = useState('');
  const [pendingError, setPendingError] = useState('');
  const [error, setError] = useState('');

  const onFloorIds = new Set(selected.map((s) => s.itemId));
  const onFloorList = selected
    .map((s) => ({ entry: s, item: items.find((i) => i.id === s.itemId) }))
    .filter((x) => x.item);
  const availableToAdd = items.filter((i) => !onFloorIds.has(i.id)).sort((a, b) => a.name.localeCompare(b.name));

  function confirmPendingQty() {
    const base = toBaseQty(pendingQty, pendingItem.unitType, pendingItem.unitsPerBox);
    if (base <= 0) {
      setPendingError('Enter a quantity greater than 0.');
      return;
    }
    setSelected((s) => [...s, { itemId: pendingItem.id, qtyOut: base }]);
    setPendingItem(null);
    setPendingQty('');
    setPendingError('');
  }

  function handleSave() {
    if (!date) {
      setError('Choose a date.');
      return;
    }
    if (selected.length === 0) {
      setError('Add at least one item to the floor.');
      return;
    }
    onSave(isNew ? null : day.id, date, selected);
    onClose();
  }

  if (pendingItem) {
    const stock = stockOf(pendingItem);
    const hint = boxHint(stock, pendingItem);
    const preview = toBaseQty(pendingQty, pendingItem.unitType, pendingItem.unitsPerBox);
    const overAvailable = pendingQty && preview > stock;
    return (
      <ModalShell onClose={onClose}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => { setPendingItem(null); setPendingQty(''); setPendingError(''); }}
              aria-label="Back"
              className="p-1.5 -ml-1.5 rounded-full hover:bg-stone-100 text-stone-500 shrink-0"
            >
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-lg font-semibold text-stone-900 truncate">{pendingItem.name}</h3>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500 shrink-0">
            <X size={20} />
          </button>
        </div>
        <p className={'text-sm mb-5 ' + (stock <= 0 ? 'text-orange-600' : 'text-stone-500')}>
          <span style={monoStyle}>{stock}</span> available{hint ? ' · ' + hint : ''}
        </p>

        <p className="text-sm text-stone-500 mb-4">How many are moving to the sales floor?</p>
        <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">
          QUANTITY {pendingItem.unitType === 'boxes' ? '(BOXES)' : '(UNITS)'}
        </label>
        <input
          type="number" inputMode="numeric" min="0"
          value={pendingQty} onChange={(e) => setPendingQty(e.target.value)}
          placeholder="0" className={inputCls} style={monoStyle} autoFocus
        />
        {pendingItem.unitType === 'boxes' && pendingQty && Number(pendingItem.unitsPerBox) > 0 && (
          <p className="text-xs text-stone-400 mt-1.5">= {preview} units</p>
        )}
        {overAvailable && <p className="text-xs text-orange-600 mt-1.5">More than what's currently available.</p>}
        {pendingError && <p className="text-sm text-rose-600 mt-1.5">{pendingError}</p>}

        <button onClick={confirmPendingQty} className="w-full mt-6 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
          Add to sales floor
        </button>
      </ModalShell>
    );
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-stone-900">{isNew ? 'New sales day' : 'Edit sales day'}</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>

      <div className="mb-5">
        <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">DATE</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} style={monoStyle} />
      </div>

      {locked && (
        <p className="text-xs text-stone-400 mb-4">
          Items are locked because this day is already completed. Delete it and start a new one to change what was on the floor.
        </p>
      )}

      {onFloorList.length > 0 && (
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-2">On the sales floor</p>
          <div className="space-y-2">
            {onFloorList.map(({ entry, item }) => (
              <div key={item.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-3.5 py-2.5">
                <div className="min-w-0 mr-2">
                  <p className="text-sm font-medium text-stone-900 truncate">{item.name}</p>
                  <p className="text-xs text-stone-500">{formatExactQty(entry.qtyOut, item)}</p>
                </div>
                {!locked && (
                  <button
                    onClick={() => setSelected((s) => s.filter((x) => x.itemId !== item.id))}
                    aria-label={'Remove ' + item.name}
                    className="p-1.5 rounded-full hover:bg-stone-200 text-stone-400 shrink-0"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!locked && availableToAdd.length > 0 ? (
        <div className="mb-5">
          <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-2">Add an item</p>
          <div className="space-y-2">
            {availableToAdd.map((item) => {
              const stock = stockOf(item);
              const hint = boxHint(stock, item);
              return (
                <button
                  key={item.id}
                  onClick={() => setPendingItem(item)}
                  className="w-full flex items-center justify-between bg-white border border-stone-200 rounded-xl px-3.5 py-2.5 hover:border-stone-300"
                >
                  <div className="min-w-0 text-left mr-2">
                    <p className="text-sm font-medium text-stone-900 truncate">{item.name}</p>
                    <p className={'text-xs mt-0.5 ' + (stock <= 0 ? 'text-orange-600' : 'text-stone-500')}>
                      <span style={monoStyle}>{stock}</span> available{hint ? ' · ' + hint : ''}
                    </p>
                  </div>
                  <Plus size={16} className="text-stone-400 shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      ) : !locked && items.length === 0 ? (
        <p className="text-sm text-stone-400 mb-5">Add items in Inventory first.</p>
      ) : null}

      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

      <button onClick={handleSave} className="w-full py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
        {isNew ? 'Create sales day' : 'Save changes'}
      </button>
    </ModalShell>
  );
}

// Day-level expenses beyond per-item cost — space rental, gas, etc. Edits persist immediately
// (via onChange) rather than waiting on a separate save step, since this list is independent of
// completing the day.
function ExtraCostsSection({ extraCosts, onChange }) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');

  function handleAdd() {
    const trimmed = label.trim();
    const parsed = Number(amount);
    if (!trimmed) {
      setError('Enter what the cost was for.');
      return;
    }
    if (!amount || !(parsed > 0)) {
      setError('Enter an amount greater than 0.');
      return;
    }
    onChange([...extraCosts, { id: generateId(), label: trimmed, amount: parsed }]);
    setLabel('');
    setAmount('');
    setError('');
  }

  return (
    <div className="mb-5">
      <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-2">Additional costs</p>
      {extraCosts.length > 0 && (
        <div className="space-y-2 mb-3">
          {extraCosts.map((c) => (
            <div key={c.id} className="flex items-center justify-between bg-stone-50 rounded-xl px-3.5 py-2.5">
              <p className="text-sm font-medium text-stone-900 truncate mr-2">{c.label}</p>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-sm text-stone-600" style={monoStyle}>{currency(c.amount)}</span>
                <button
                  onClick={() => onChange(extraCosts.filter((x) => x.id !== c.id))}
                  aria-label={'Remove ' + c.label}
                  className="p-1 rounded-full hover:bg-stone-200 text-stone-400"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Space rental" className={inputCls + ' flex-1'}
        />
        <input
          type="number" inputMode="decimal" min="0" step="0.01"
          value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00" className={inputCls} style={{ ...monoStyle, width: 90 }}
        />
        <button onClick={handleAdd} aria-label="Add cost" className="px-3 rounded-xl bg-stone-900 text-white shrink-0">
          <Plus size={16} />
        </button>
      </div>
      {error && <p className="text-xs text-rose-600 mt-1.5">{error}</p>}
    </div>
  );
}

function SalesDayDetailModal({ day, items, onClose, onComplete, onUpdateExtraCosts }) {
  const [remaining, setRemaining] = useState({});
  const [copyState, setCopyState] = useState('idle');
  const [extraCosts, setExtraCosts] = useState(() => day.extraCosts || []);
  const rows = day.items.map((entry) => ({ entry, item: items.find((i) => i.id === entry.itemId) })).filter((x) => x.item);
  const isActive = day.status === 'active';

  function handleComplete() {
    const remainingBase = {};
    for (const { item } of rows) {
      const raw = remaining[item.id];
      if (raw === undefined || raw === '') continue;
      remainingBase[item.id] = toBaseQty(raw, item.unitType, item.unitsPerBox);
    }
    onComplete(day.id, remainingBase);
    onClose();
  }

  function handleExtraCostsChange(next) {
    setExtraCosts(next);
    onUpdateExtraCosts(day.id, next);
  }

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (e) {
      setCopyState('error');
    }
  }

  async function handleShare() {
    const text = buildSalesDaySummaryText(day, rows, totalCost, totalRevenue, profit, extraCosts);
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'Sales day \u2014 ' + formatDateLabel(day.date), text });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    handleCopy(text);
  }

  function soldFor(entry, item) {
    if (!isActive) return entry.sold || 0;
    const raw = remaining[item.id];
    if (raw === undefined || raw === '') return 0;
    const remainingBase = toBaseQty(raw, item.unitType, item.unitsPerBox);
    return Math.max(0, entry.qtyOut - remainingBase);
  }

  const totalSold = rows.reduce((sum, { entry, item }) => sum + soldFor(entry, item), 0);
  const totalCost = rows.reduce((sum, { entry, item }) => sum + (item.cost || 0) * soldFor(entry, item), 0);
  const totalRevenue = rows.reduce((sum, { entry, item }) => sum + (item.salePrice || 0) * soldFor(entry, item), 0);
  const totalExtraCosts = extraCosts.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const profit = totalRevenue - totalCost - totalExtraCosts;

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-lg font-semibold text-stone-900">{isActive ? 'Complete sales day' : 'Sales day'}</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>
      <p className="text-sm text-stone-500 mb-4">{formatDateLabel(day.date)}</p>

      {rows.length === 0 ? (
        <p className="text-sm text-stone-400 py-4">No items are on record for this sales day.</p>
      ) : isActive ? (
        <>
          <p className="text-sm text-stone-500 mb-4">Enter what's left on the floor for each item.</p>
          <div className="space-y-4 mb-5">
            {rows.map(({ entry, item }) => {
              const raw = remaining[item.id];
              const hasValue = raw !== undefined && raw !== '';
              const remainingBase = hasValue ? toBaseQty(raw, item.unitType, item.unitsPerBox) : null;
              const soldToday = remainingBase !== null ? Math.max(0, entry.qtyOut - remainingBase) : null;
              const over = remainingBase !== null && remainingBase > entry.qtyOut;
              return (
                <div key={item.id} className="border border-stone-200 rounded-xl p-3.5">
                  <p className="font-medium text-stone-900 truncate mb-0.5">{item.name}</p>
                  <p className="text-xs text-stone-400 mb-3">Started with {formatExactQty(entry.qtyOut, item)}</p>
                  <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">
                    REMAINING {item.unitType === 'boxes' ? '(BOXES)' : '(UNITS)'}
                  </label>
                  <input
                    type="number" inputMode="numeric" min="0"
                    value={raw === undefined ? '' : raw}
                    onChange={(e) => setRemaining((r) => ({ ...r, [item.id]: e.target.value }))}
                    placeholder="0" className={inputCls} style={monoStyle}
                  />
                  <p className={'text-xs mt-1.5 ' + (over ? 'text-orange-600' : 'text-stone-400')}>
                    {soldToday === null ? 'Sold: —' : over ? 'More than started — will count as 0 sold' : 'Sold: ' + formatExactQty(soldToday, item)}
                  </p>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div className="space-y-3 mb-5">
          {rows.map(({ entry, item }) => (
            <div key={item.id} className="border border-stone-200 rounded-xl p-3.5">
              <p className="font-medium text-stone-900 truncate mb-2">{item.name}</p>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Started" value={entry.qtyOut} />
                <Stat label="Remaining" value={entry.remaining || 0} />
                <Stat label="Sold" value={entry.sold || 0} tone="positive" />
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <p className="text-sm text-stone-500 mb-3">
            Total sold{isActive ? ' so far' : ''}: <span className="font-semibold text-stone-900" style={monoStyle}>{totalSold}</span> units
          </p>
          <ExtraCostsSection extraCosts={extraCosts} onChange={handleExtraCostsChange} />
          <div className={'grid gap-2 mb-5 ' + (totalExtraCosts > 0 ? 'grid-cols-4' : 'grid-cols-3')}>
            <Stat label="Cost" value={currency(totalCost)} />
            {totalExtraCosts > 0 && <Stat label="Extra" value={currency(totalExtraCosts)} />}
            <Stat label="Revenue" value={currency(totalRevenue)} />
            <Stat label="Profit" value={currency(profit)} tone={profit < 0 ? 'negative' : 'positive'} />
          </div>
        </>
      )}

      <div className="flex gap-2">
        {isActive && rows.length > 0 && (
          <button onClick={handleComplete} className="flex-1 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
            Complete sales day
          </button>
        )}
        {!isActive && (
          <>
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-700 font-medium hover:bg-stone-50">
              Close
            </button>
            {rows.length > 0 && (
              <button
                onClick={handleShare}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900"
              >
                <Share2 size={16} /> {copyState === 'copied' ? 'Copied' : 'Share'}
              </button>
            )}
          </>
        )}
      </div>
    </ModalShell>
  );
}

function SalesDayActionSheet({ day, onClose, onEdit, onDelete }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-lg font-semibold text-stone-900">{formatDateLabel(day.date)}</h3>
          <p className="text-xs text-stone-400 mt-0.5">{day.status === 'active' ? 'Active' : 'Completed'} sales day</p>
        </div>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>

      {!confirmingDelete ? (
        <div className="space-y-2">
          <button
            onClick={onEdit}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-stone-200 hover:bg-stone-50 text-stone-900 font-medium"
          >
            <Pencil size={18} className="text-stone-500" /> Edit sales day
          </button>
          <button
            onClick={() => setConfirmingDelete(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-rose-200 hover:bg-rose-50 text-rose-600 font-medium"
          >
            <Trash2 size={18} /> Delete sales day
          </button>
        </div>
      ) : (
        <div>
          <p className="text-sm text-stone-500 mb-4">
            Slide to permanently delete this sales day{day.status === 'completed' ? ' and remove its sales from your totals' : ''}.
          </p>
          <SlideToConfirm label="Slide to delete" onConfirm={() => { onDelete(day.id); onClose(); }} />
          <button onClick={() => setConfirmingDelete(false)} className="w-full text-center text-sm text-stone-500 hover:text-stone-700 py-3 mt-2">
            Cancel
          </button>
        </div>
      )}
    </ModalShell>
  );
}

function SalesDayRow({ day, items, onOpen, onLongPress }) {
  const rows = day.items.map((entry) => ({ entry, item: items.find((i) => i.id === entry.itemId) })).filter((x) => x.item);
  const itemCount = rows.length;
  const isActive = day.status === 'active';
  const totalSold = !isActive ? rows.reduce((sum, { entry }) => sum + (entry.sold || 0), 0) : null;
  const { pressing, handlers } = useLongPress(onLongPress, onOpen, 500);

  return (
    <button
      {...handlers}
      className={
        'w-full flex items-center justify-between rounded-2xl border border-stone-200 p-4 transition-colors text-left select-none ' +
        (pressing ? 'bg-stone-50' : 'bg-white hover:border-stone-300')
      }
      style={{ WebkitTouchCallout: 'none' }}
    >
      <div className="min-w-0 mr-3">
        <p className="font-medium text-stone-900">{formatDateLabel(day.date)}</p>
        <p className="text-sm text-stone-500 mt-0.5">
          {itemCount} item{itemCount !== 1 ? 's' : ''}{totalSold !== null ? ' · ' + totalSold + ' sold' : ''}
        </p>
      </div>
      <span
        className={
          'flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ' +
          (isActive ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-800')
        }
      >
        {isActive ? <ClipboardList size={13} /> : <CheckCircle2 size={13} />}
        {isActive ? 'Active' : 'Completed'}
      </span>
    </button>
  );
}

/* ---------- calendar modal ---------- */

function EventModal({ event, defaultDate, onClose, onSave, onDelete }) {
  const isNew = !event;
  const [title, setTitle] = useState(event ? event.title : '');
  const [type, setType] = useState(event ? event.type : 'event');
  const [date, setDate] = useState(event ? event.date : defaultDate);
  const [amount, setAmount] = useState(event ? String(event.amount || 0) : '');
  const [notes, setNotes] = useState(event ? event.notes || '' : '');
  const [error, setError] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  function handleSave() {
    if (!title.trim()) {
      setError('Enter a title.');
      return;
    }
    if (!date) {
      setError('Choose a date.');
      return;
    }
    onSave({
      id: event ? event.id : generateId(),
      title: title.trim(),
      type,
      date,
      amount: type === 'expense' ? Math.max(0, Number(amount) || 0) : 0,
      notes: notes.trim(),
    });
    onClose();
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-stone-900">
          {isNew ? 'Add to calendar' : type === 'expense' ? 'Edit expense' : 'Edit event'}
        </h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setType('event')}
          className={
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium border ' +
            (type === 'event' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'border-stone-200 text-stone-500')
          }
        >
          <CalendarDays size={15} /> Event
        </button>
        <button
          onClick={() => setType('expense')}
          className={
            'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-medium border ' +
            (type === 'expense' ? 'bg-amber-50 border-amber-300 text-amber-700' : 'border-stone-200 text-stone-500')
          }
        >
          <Receipt size={15} /> Expense
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">TITLE</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={type === 'expense' ? 'e.g. Supplier invoice' : 'e.g. Vendor meeting'}
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">DATE</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} style={monoStyle} />
        </div>
        {type === 'expense' && (
          <div>
            <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">AMOUNT ($)</label>
            <input
              type="number" inputMode="decimal" step="0.01" min="0"
              value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00" className={inputCls} style={monoStyle}
            />
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-stone-500 mb-1.5 tracking-wide">NOTES (OPTIONAL)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls + ' resize-none'} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
      </div>

      <div className="flex gap-2 mt-6">
        {!isNew && !confirmDelete && (
          <button onClick={() => setConfirmDelete(true)} aria-label="Delete" className="p-2.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 shrink-0">
            <Trash2 size={18} />
          </button>
        )}
        {!isNew && confirmDelete && (
          <button
            onClick={() => { onDelete(event.id); onClose(); }}
            className="px-3 py-2.5 rounded-xl bg-rose-600 text-white text-sm font-medium shrink-0"
          >
            Confirm delete
          </button>
        )}
        <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-700 font-medium hover:bg-stone-50">
          Cancel
        </button>
        <button onClick={handleSave} className="flex-1 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
          Save
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------- tabs ---------- */

function SalesTab({ items, salesDays, onSaveDay, onCompleteDay, onDeleteDay, onUpdateExtraCosts }) {
  const [formDay, setFormDay] = useState(undefined); // undefined = closed, null = new, object = editing
  const [detailDay, setDetailDay] = useState(null); // tap: view / complete
  const [actionDay, setActionDay] = useState(null); // long-press: edit / delete

  const active = useMemo(
    () => salesDays.filter((d) => d.status === 'active').sort((a, b) => b.date.localeCompare(a.date)),
    [salesDays]
  );
  const completed = useMemo(
    () => salesDays.filter((d) => d.status === 'completed').sort((a, b) => b.date.localeCompare(a.date)),
    [salesDays]
  );

  function renderRow(day) {
    return (
      <SalesDayRow
        key={day.id}
        day={day}
        items={items}
        onOpen={() => setDetailDay(day)}
        onLongPress={() => setActionDay(day)}
      />
    );
  }

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-stone-900">Sales</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            {salesDays.length === 0 ? 'No sales days yet' : active.length + ' active · ' + completed.length + ' completed'}
          </p>
        </div>
        <button
          onClick={() => setFormDay(null)}
          className="flex items-center gap-1.5 bg-green-800 text-white px-3.5 py-2.5 rounded-xl text-sm font-medium hover:bg-green-900 shrink-0"
        >
          <Plus size={16} /> Add sales day
        </button>
      </div>

      {salesDays.length === 0 ? (
        <EmptyState icon={ShoppingBag} text="Start a sales day to choose what's going out and track what sells." />
      ) : (
        <>
          <p className="text-xs text-stone-400 mb-4">Tap a day to open it. Press and hold for more options.</p>
          <div className="space-y-5">
            {active.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-2">Active</p>
                <div className="space-y-3">{active.map(renderRow)}</div>
              </div>
            )}
            {completed.length > 0 && (
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-400 font-medium mb-2">Completed</p>
                <div className="space-y-3">{completed.map(renderRow)}</div>
              </div>
            )}
          </div>
        </>
      )}

      {formDay !== undefined && (
        <SalesDayFormModal day={formDay} items={items} onClose={() => setFormDay(undefined)} onSave={onSaveDay} />
      )}
      {detailDay && (
        <SalesDayDetailModal
          day={detailDay}
          items={items}
          onClose={() => setDetailDay(null)}
          onComplete={onCompleteDay}
          onUpdateExtraCosts={onUpdateExtraCosts}
        />
      )}
      {actionDay && (
        <SalesDayActionSheet
          day={actionDay}
          onClose={() => setActionDay(null)}
          onEdit={() => { setFormDay(actionDay); setActionDay(null); }}
          onDelete={onDeleteDay}
        />
      )}
    </div>
  );
}

function InventoryTab({ items, onSave, onSaveMultiple, onDelete }) {
  const [modalItem, setModalItem] = useState(undefined);
  const [addMultipleOpen, setAddMultipleOpen] = useState(false);
  const [purchaseOpen, setPurchaseOpen] = useState(false);
  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name)), [items]);
  const lowStockCount = useMemo(() => items.filter((i) => stockOf(i) < i.min).length, [items]);

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-2xl font-semibold text-stone-900">Inventory</h2>
          <p className="text-sm text-stone-500 mt-0.5">{items.length} item{items.length !== 1 ? 's' : ''} in catalog</p>
        </div>
        <button
          onClick={() => setModalItem(null)}
          className="flex items-center gap-1.5 bg-green-800 text-white px-3.5 py-2.5 rounded-xl text-sm font-medium hover:bg-green-900 shrink-0"
        >
          <Plus size={16} /> Add item
        </button>
      </div>

      <button
        onClick={() => setAddMultipleOpen(true)}
        className="w-full flex items-center justify-center gap-2 border border-stone-200 text-stone-700 py-2.5 rounded-xl text-sm font-medium hover:bg-stone-50 mb-3"
      >
        <Plus size={16} /> Add multiple items
      </button>

      {items.length > 0 && (
        <button
          onClick={() => setPurchaseOpen(true)}
          className="w-full flex items-center justify-center gap-2 border border-stone-200 text-stone-700 py-2.5 rounded-xl text-sm font-medium hover:bg-stone-50 mb-4"
        >
          <Share2 size={16} />
          Create purchase list
          {lowStockCount > 0 && (
            <span className="bg-orange-100 text-orange-700 text-xs font-semibold px-2 py-0.5 rounded-full" style={monoStyle}>
              {lowStockCount}
            </span>
          )}
        </button>
      )}

      {items.length === 0 ? (
        <EmptyState icon={Package} text="Add an item to start tracking stock levels." />
      ) : (
        <div className="space-y-3">
          {sorted.map((item) => {
            const stock = stockOf(item);
            const low = stock < item.min;
            const range = Math.max(item.max, item.min, stock, 1);
            const pct = Math.min(100, Math.round((stock / range) * 100));
            const hint = boxHint(stock, item);
            return (
              <button
                key={item.id}
                onClick={() => setModalItem(item)}
                className="w-full text-left bg-white rounded-2xl border border-stone-200 p-4 hover:border-stone-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <p className="font-medium text-stone-900 truncate">{item.name}</p>
                    <p className="text-sm text-stone-500 mt-0.5">
                      <span style={monoStyle}>{stock}</span> on hand{hint ? ' · ' + hint : ''}
                    </p>
                  </div>
                  {low ? (
                    <span className="flex items-center gap-1 bg-orange-50 text-orange-700 text-xs font-medium px-2.5 py-1 rounded-full shrink-0">
                      <AlertTriangle size={13} /> Order more
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 bg-green-50 text-green-800 text-xs font-medium px-2.5 py-1 rounded-full shrink-0">
                      <CheckCircle2 size={13} /> Well stocked
                    </span>
                  )}
                </div>
                <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                  <div className={'h-full rounded-full ' + (low ? 'bg-orange-400' : 'bg-green-700')} style={{ width: pct + '%' }} />
                </div>
                <div className="flex justify-between text-xs text-stone-400 mt-1.5">
                  <span>Min <span style={monoStyle}>{item.min}</span></span>
                  <span>Max <span style={monoStyle}>{item.max}</span></span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {modalItem !== undefined && (
        <ItemEditModal item={modalItem} onClose={() => setModalItem(undefined)} onSave={onSave} onDelete={onDelete} />
      )}
      {addMultipleOpen && <AddMultipleModal onClose={() => setAddMultipleOpen(false)} onSaveMultiple={onSaveMultiple} />}
      {purchaseOpen && <PurchaseListModal items={items} onClose={() => setPurchaseOpen(false)} />}
    </div>
  );
}

function CalendarTab({ events, onSave, onDelete }) {
  const today = new Date();
  const todayKey = toDateKey(today);
  const [viewDate, setViewDate] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [modalEvent, setModalEvent] = useState(undefined);

  const isCurrentMonthView = viewDate.getFullYear() === today.getFullYear() && viewDate.getMonth() === today.getMonth();

  const grid = useMemo(() => {
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const startWeekday = firstDay.getDay();
    const cells = [];
    for (let i = 0; i < startWeekday; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
    return cells;
  }, [viewDate]);

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const e of events) {
      if (!map[e.date]) map[e.date] = [];
      map[e.date].push(e);
    }
    for (const key in map) {
      map[key].sort((a, b) => a.title.localeCompare(b.title));
    }
    return map;
  }, [events]);

  const upcoming = useMemo(() => {
    return events
      .filter((e) => e.date >= todayKey)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
  }, [events, todayKey]);

  const monthExpenseTotal = useMemo(() => {
    const y = viewDate.getFullYear();
    const m = String(viewDate.getMonth() + 1).padStart(2, '0');
    const prefix = y + '-' + m;
    return events
      .filter((e) => e.type === 'expense' && e.date.startsWith(prefix))
      .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
  }, [events, viewDate]);

  const selectedDayEvents = eventsByDay[selectedDay] || [];

  return (
    <div className="px-4 pt-2 pb-8">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-2xl font-semibold text-stone-900">Calendar</h2>
          <p className="text-sm text-stone-500 mt-0.5">
            {monthExpenseTotal > 0 ? (
              <span><span style={monoStyle}>{currency(monthExpenseTotal)}</span> in expenses this month</span>
            ) : (
              'Plan events and expenses ahead'
            )}
          </p>
        </div>
        <button
          onClick={() => setModalEvent(null)}
          aria-label="Add event or expense"
          className="w-10 h-10 rounded-full bg-green-800 text-white flex items-center justify-center hover:bg-green-900 shrink-0"
        >
          <Plus size={20} />
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 p-4 mt-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
            aria-label="Previous month"
            className="p-2 rounded-full hover:bg-stone-100 text-stone-500"
          >
            <ChevronLeft size={20} />
          </button>
          <p className="font-semibold text-stone-900">{MONTH_NAMES[viewDate.getMonth()]} {viewDate.getFullYear()}</p>
          <button
            onClick={() => setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
            aria-label="Next month"
            className="p-2 rounded-full hover:bg-stone-100 text-stone-500"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="text-center text-xs font-medium text-stone-400">{w}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-y-1">
          {grid.map((date, idx) => {
            if (!date) return <div key={idx} />;
            const key = toDateKey(date);
            const isToday = key === todayKey;
            const isSelected = key === selectedDay;
            const isPast = isCurrentMonthView && key < todayKey;
            const dayEvents = eventsByDay[key] || [];
            return (
              <button key={idx} onClick={() => setSelectedDay(key)} className="flex flex-col items-center py-1.5">
                <span
                  className={
                    'w-9 h-9 flex items-center justify-center rounded-full text-sm ' +
                    (isSelected
                      ? 'bg-green-800 text-white font-semibold'
                      : isToday
                      ? 'border-2 border-green-700 text-green-800 font-semibold'
                      : isPast
                      ? 'text-stone-300'
                      : 'text-stone-700')
                  }
                  style={monoStyle}
                >
                  {date.getDate()}
                </span>
                <span className="h-1.5 mt-0.5 flex items-center justify-center">
                  {dayEvents.length > 0 && (
                    <span className={'block w-1.5 h-1.5 rounded-full ' + (isSelected ? 'bg-green-800' : 'bg-amber-500')} />
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-5">
        <p className="text-sm font-semibold text-stone-900 mb-2">{formatDateLabel(selectedDay)}</p>
        {selectedDayEvents.length === 0 ? (
          <p className="text-sm text-stone-400">Nothing planned for this day.</p>
        ) : (
          <div className="space-y-2">
            {selectedDayEvents.map((e) => (
              <EventRow key={e.id} event={e} onClick={() => setModalEvent(e)} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <p className="text-sm font-semibold text-stone-900 mb-2">Upcoming</p>
        {upcoming.length === 0 ? (
          <p className="text-sm text-stone-400">Nothing on the horizon yet.</p>
        ) : (
          <div className="space-y-2">
            {upcoming.map((e) => (
              <EventRow key={e.id} event={e} showDate onClick={() => setModalEvent(e)} />
            ))}
          </div>
        )}
      </div>

      {modalEvent !== undefined && (
        <EventModal
          event={modalEvent}
          defaultDate={selectedDay}
          onClose={() => setModalEvent(undefined)}
          onSave={onSave}
          onDelete={onDelete}
        />
      )}
    </div>
  );
}

/* ---------- backup / restore ---------- */

function BackupModal({ items, events, salesDays, onClose, onRestore, onReset }) {
  const [mode, setMode] = useState('export');
  const [pasteValue, setPasteValue] = useState('');
  const [error, setError] = useState('');
  const [copyState, setCopyState] = useState('idle');
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [resetMode, setResetMode] = useState(false);

  const backupText = JSON.stringify({ items, events, salesDays }, null, 2);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(backupText);
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (e) {
      setCopyState('error');
    }
  }

  async function handleShare() {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'In Stock backup', text: backupText });
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    handleCopy();
  }

  function parseAndRestore() {
    let parsed;
    try {
      parsed = JSON.parse(pasteValue);
    } catch (e) {
      setError("That doesn't look like a valid backup. Make sure you paste the whole thing.");
      return;
    }
    const looksValid = parsed && typeof parsed === 'object' && ('items' in parsed || 'events' in parsed || 'salesDays' in parsed);
    if (!looksValid) {
      setError("That doesn't look like a valid backup.");
      return;
    }
    onRestore({
      items: Array.isArray(parsed.items) ? parsed.items : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
      salesDays: Array.isArray(parsed.salesDays) ? parsed.salesDays : [],
    });
    onClose();
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-stone-900">Backup &amp; restore</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => { setMode('export'); setConfirmRestore(false); setResetMode(false); setError(''); }}
          className={
            'flex-1 py-2.5 rounded-xl text-sm font-medium border ' +
            (mode === 'export' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'border-stone-200 text-stone-500')
          }
        >
          Export
        </button>
        <button
          onClick={() => { setMode('import'); setConfirmRestore(false); setResetMode(false); setError(''); }}
          className={
            'flex-1 py-2.5 rounded-xl text-sm font-medium border ' +
            (mode === 'import' ? 'bg-sky-50 border-sky-300 text-sky-700' : 'border-stone-200 text-stone-500')
          }
        >
          Restore
        </button>
      </div>

      {mode === 'export' ? (
        <>
          <p className="text-sm text-stone-500 mb-4">
            Save this somewhere safe (notes app, email to yourself). If your data ever disappears, paste it back in under Restore.
          </p>
          <button
            onClick={handleShare}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900 mb-3"
          >
            <Share2 size={16} /> {copyState === 'copied' ? 'Copied to clipboard' : 'Share backup'}
          </button>
          <textarea
            readOnly
            value={backupText}
            onClick={(e) => e.target.select()}
            rows={8}
            className="w-full rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 resize-none"
            style={monoStyle}
          />
          <p className="text-xs text-stone-400 mt-1.5">Tap the text above to select it if sharing doesn't open.</p>
        </>
      ) : (
        <>
          <p className="text-sm text-stone-500 mb-3">Paste a previously saved backup below.</p>
          <textarea
            value={pasteValue}
            onChange={(e) => { setPasteValue(e.target.value); setError(''); setConfirmRestore(false); }}
            rows={8}
            placeholder="Paste backup text here…"
            className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs text-stone-700 resize-none"
            style={monoStyle}
          />
          {error && <p className="text-sm text-rose-600 mt-2">{error}</p>}

          {!confirmRestore ? (
            <button
              onClick={() => { if (pasteValue.trim()) setConfirmRestore(true); else setError('Paste a backup first.'); }}
              className="w-full mt-4 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900"
            >
              Restore backup
            </button>
          ) : (
            <div className="mt-4">
              <p className="text-sm text-orange-600 mb-2">This replaces everything currently in the app. Continue?</p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmRestore(false)} className="flex-1 py-2.5 rounded-xl border border-stone-200 text-stone-700 font-medium hover:bg-stone-50">
                  Cancel
                </button>
                <button onClick={parseAndRestore} className="flex-1 py-2.5 rounded-xl bg-green-800 text-white font-medium hover:bg-green-900">
                  Yes, restore
                </button>
              </div>
            </div>
          )}

          {!resetMode ? (
            <button onClick={() => setResetMode(true)} className="w-full text-center text-sm text-stone-500 hover:text-stone-700 py-3 mt-3">
              Or start fresh instead
            </button>
          ) : (
            <div className="mt-3 pt-3 border-t border-stone-200">
              <p className="text-sm text-stone-500 mb-3">
                Clears every item, event, and sales day so this opens empty — for a new user, or to wipe your own test data. This can't be undone unless you've saved a backup.
              </p>
              <SlideToConfirm label="Slide to clear everything" onConfirm={() => { onReset(); onClose(); }} />
              <button onClick={() => setResetMode(false)} className="w-full text-center text-sm text-stone-500 hover:text-stone-700 py-3 mt-2">
                Cancel
              </button>
            </div>
          )}
        </>
      )}
    </ModalShell>
  );
}

/* ---------- shell ---------- */

function SaveErrorBanner() {
  return (
    <div className="bg-rose-50 border-b border-rose-200 px-4 py-2">
      <p className="text-xs text-rose-700 font-medium text-center">
        A change didn't save. Check your connection — it'll retry automatically on your next edit.
      </p>
    </div>
  );
}

function ManualInstallModal({ isIos, onClose }) {
  return (
    <ModalShell onClose={onClose}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-stone-900">Install In Stock</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-full hover:bg-stone-100 text-stone-500">
          <X size={20} />
        </button>
      </div>
      <div className="flex items-start gap-2 text-sm text-stone-500 mb-5">
        {isIos ? <Share2 size={16} className="text-green-800 flex-shrink-0 mt-0.5" /> : <Download size={16} className="text-green-800 flex-shrink-0 mt-0.5" />}
        {isIos
          ? 'Tap the Share icon in Safari, then choose "Add to Home Screen".'
          : 'Open your browser menu (⋮) and tap "Install app" — or "Add to Home screen" then "Install". Avoid "Create shortcut": that just opens in the browser.'}
      </div>
      <button onClick={onClose} className="w-full py-2.5 rounded-lg text-sm font-medium bg-green-800 text-white">
        Got it
      </button>
    </ModalShell>
  );
}

function TopBar({ items, events, salesDays, onRestore, onReset, user, onSignIn, onSignOut }) {
  const [backupOpen, setBackupOpen] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const todayLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  async function handleSignIn() {
    setSigningIn(true);
    await onSignIn();
    setSigningIn(false); // only matters if sign-in failed/was cancelled; success unmounts this button
  }

  return (
    <div className="px-4 pt-5 pb-1">
      <div className="flex items-center justify-between mb-1.5">
        <a href="https://mattsapps.xyz" className="text-xs" style={{ ...monoStyle, color: '#a8a29e', letterSpacing: '0.05em', textDecoration: 'none' }}>
          ← mattsapps
        </a>
        {user ? (
          <div className="flex items-center gap-2">
            {user.photoURL && (
              <img src={user.photoURL} alt="" referrerPolicy="no-referrer" className="w-5 h-5 rounded-full border border-stone-200" />
            )}
            <button onClick={onSignOut} aria-label={'Sign out of ' + (user.email || 'your account')} className="text-stone-400 hover:text-stone-600">
              <LogOut size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium text-stone-600 border border-stone-200 hover:border-stone-300 disabled:opacity-60"
          >
            <GoogleIcon />
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        )}
      </div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">In Stock</p>
        <div className="flex items-center gap-3">
          <p className="text-xs text-stone-400">{todayLabel}</p>
          <button onClick={() => setBackupOpen(true)} aria-label="Backup and restore your data" className="text-stone-400 hover:text-stone-600">
            <Save size={15} />
          </button>
        </div>
      </div>
      {backupOpen && (
        <BackupModal items={items} events={events} salesDays={salesDays} onClose={() => setBackupOpen(false)} onRestore={onRestore} onReset={onReset} />
      )}
    </div>
  );
}

function TabBar({ activeTab, setActiveTab }) {
  const tabs = [
    { id: 'sales', label: 'Sales', icon: ShoppingBag },
    { id: 'inventory', label: 'Inventory', icon: Package },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
  ];
  return (
    <div className="bg-white border-b border-stone-200 flex">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = activeTab === t.id;
        return (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={'flex-1 flex flex-col items-center gap-1 py-3 ' + (active ? 'text-green-800' : 'text-stone-400')}
          >
            <Icon size={22} strokeWidth={active ? 2.4 : 2} />
            <span className={'text-xs ' + (active ? 'font-semibold' : 'font-medium')}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- app ---------- */

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('sales');
  const [items, setItems] = useState(() => migrateItems(loadLocalData().items));
  const [events, setEvents] = useState(() => loadLocalData().events);
  const [salesDays, setSalesDays] = useState(() => loadLocalData().salesDays);
  const [dataReady, setDataReady] = useState(true); // false only while waiting on a signed-in user's first Firestore snapshot
  const [saveError, setSaveError] = useState(false);
  // Which uid (if any) the current items/events/salesDays came from Firestore for — lets the
  // snapshot handler below tell "brand new account" apart from "just hasn't loaded yet".
  const hydratedUid = useRef(null);

  const [installPrompt, setInstallPrompt] = useState(null); // deferred beforeinstallprompt event
  const [installed, setInstalled] = useState(false);
  const [showManualInstall, setShowManualInstall] = useState(false);
  const [{ isStandalone, isIos }] = useState(() => {
    if (typeof window === 'undefined') return { isStandalone: false, isIos: false };
    const standalone =
      window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
    return { isStandalone: standalone, isIos: ios };
  });

  const { visible: keyboardVisible, dismiss: dismissKeyboard } = useActiveTextInput();

  // Tracks whether anyone is signed in. Firebase persists this across app restarts on its
  // own — there's no equivalent of the old "storage keeps resetting" problem here. Sign-in
  // is optional: the app is fully usable signed out, backed by localStorage on this device.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthChecked(true);
    });
    return unsub;
  }, []);

  // Once signed in, stay subscribed to this user's document in real time — it updates
  // automatically after this app's own saves, and would also pick up changes made from
  // another device signed into the same account. Signed out (including right after sign-out),
  // fall back to this device's local copy instead of Firestore.
  useEffect(() => {
    if (!user) {
      hydratedUid.current = null;
      const local = loadLocalData();
      setItems(migrateItems(local.items));
      setEvents(local.events);
      setSalesDays(local.salesDays);
      setDataReady(true);
      return;
    }
    setDataReady(false);
    const unsub = subscribeUserData(
      user.uid,
      (data) => {
        if (data) {
          setItems(migrateItems(data.items));
          setEvents(Array.isArray(data.events) ? data.events : []);
          setSalesDays(Array.isArray(data.salesDays) ? data.salesDays : []);
        } else if (hydratedUid.current !== user.uid) {
          // First time this account has ever signed in (no Firestore doc yet) — carry over
          // whatever was already entered anonymously on this device instead of starting empty.
          const local = loadLocalData();
          const migratedItems = migrateItems(local.items);
          setItems(migratedItems);
          setEvents(local.events);
          setSalesDays(local.salesDays);
          saveUserData(user.uid, { items: migratedItems, events: local.events, salesDays: local.salesDays });
        }
        hydratedUid.current = user.uid;
        setDataReady(true);
      },
      () => setDataReady(true) // still stop showing a spinner if the subscription itself errors
    );
    return unsub;
  }, [user]);

  // Pick up Chrome's install prompt — it's captured by an early inline script in index.html
  // (it can fire before React mounts), and also relayed via a custom event. Hide the button
  // once the app is installed.
  useEffect(() => {
    if (typeof window !== 'undefined' && window.__deferredInstallPrompt) {
      setInstallPrompt(window.__deferredInstallPrompt);
    }
    const onAvail = () => setInstallPrompt(window.__deferredInstallPrompt || null);
    const onInstalled = () => {
      setInstallPrompt(null);
      setInstalled(true);
    };
    window.addEventListener('pwa-install-available', onAvail);
    window.addEventListener('pwa-installed', onInstalled);
    return () => {
      window.removeEventListener('pwa-install-available', onAvail);
      window.removeEventListener('pwa-installed', onInstalled);
    };
  }, []);

  const handleInstall = async () => {
    // 1. Newer Web Install API (Chrome 139+): installs the current app directly, without
    //    needing a captured beforeinstallprompt event.
    if (typeof navigator !== 'undefined' && typeof navigator.install === 'function') {
      try {
        await navigator.install();
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // user dismissed the dialog
        // any other error → fall through to the older paths
      }
    }

    // 2. Classic captured beforeinstallprompt event.
    const dp = installPrompt || (typeof window !== 'undefined' ? window.__deferredInstallPrompt : null);
    if (dp) {
      dp.prompt();
      try {
        await dp.userChoice;
      } catch (e) {
        /* ignore */
      }
      setInstallPrompt(null);
      if (typeof window !== 'undefined') window.__deferredInstallPrompt = null;
      return;
    }

    // 3. Nothing the browser will let us trigger programmatically — show the platform-specific
    //    manual instructions as a last resort.
    setShowManualInstall(true);
  };

  // Offer the install affordance until the app is actually installed / running standalone. The
  // button always does something helpful (native prompt or a how-to modal), so it never
  // silently no-ops.
  const canInstall = !isStandalone && !installed;

  async function persistAll(nextItems, nextEvents, nextSalesDays) {
    setItems(nextItems);
    setEvents(nextEvents);
    setSalesDays(nextSalesDays);
    if (user) {
      const ok = await saveUserData(user.uid, { items: nextItems, events: nextEvents, salesDays: nextSalesDays });
      setSaveError(!ok);
    } else {
      saveLocalData({ items: nextItems, events: nextEvents, salesDays: nextSalesDays });
    }
  }

  async function persistItems(next) {
    await persistAll(next, events, salesDays);
  }

  async function persistEvents(next) {
    await persistAll(items, next, salesDays);
  }

  async function persistSalesDays(next) {
    await persistAll(items, events, next);
  }

  function upsertItem(item) {
    const exists = items.some((i) => i.id === item.id);
    const next = exists ? items.map((i) => (i.id === item.id ? item : i)) : [...items, item];
    persistItems(next);
  }
  function addMultipleItems(newItems) {
    persistItems([...items, ...newItems]);
  }
  function deleteItem(id) {
    persistItems(items.filter((i) => i.id !== id));
  }
  function upsertEvent(evt) {
    const exists = events.some((e) => e.id === evt.id);
    const next = exists ? events.map((e) => (e.id === evt.id ? evt : e)) : [...events, evt];
    persistEvents(next);
  }
  function deleteEvent(id) {
    persistEvents(events.filter((e) => e.id !== id));
  }

  function saveSalesDay(dayId, date, selectedItems) {
    if (!dayId) {
      const newDay = {
        id: generateId(),
        date,
        status: 'active',
        items: selectedItems.map((s) => ({ itemId: s.itemId, qtyOut: s.qtyOut, remaining: null, sold: null })),
      };
      persistSalesDays([...salesDays, newDay]);
      return;
    }
    persistSalesDays(
      salesDays.map((d) => {
        if (d.id !== dayId) return d;
        if (d.status === 'completed') return { ...d, date }; // items are locked once completed; only the date can change
        return {
          ...d,
          date,
          items: selectedItems.map((s) => ({ itemId: s.itemId, qtyOut: s.qtyOut, remaining: null, sold: null })),
        };
      })
    );
  }

  function completeSalesDay(dayId, remainingBaseMap) {
    const day = salesDays.find((d) => d.id === dayId);
    if (!day) return;

    const updatedDayItems = day.items.map((entry) => {
      const remainingQty = remainingBaseMap[entry.itemId];
      if (remainingQty === undefined) return entry;
      const soldQty = Math.max(0, entry.qtyOut - remainingQty);
      return { ...entry, remaining: remainingQty, sold: soldQty };
    });
    const nextSalesDays = salesDays.map((d) => (d.id === dayId ? { ...d, status: 'completed', items: updatedDayItems } : d));

    const nextItems = items.map((item) => {
      const entry = day.items.find((e) => e.itemId === item.id);
      if (!entry) return item;
      const remainingQty = remainingBaseMap[item.id];
      if (remainingQty === undefined) return item;
      const soldQty = Math.max(0, entry.qtyOut - remainingQty);
      return soldQty > 0 ? { ...item, sold: item.sold + soldQty } : item;
    });

    persistAll(nextItems, events, nextSalesDays);
  }

  function deleteSalesDay(dayId) {
    const day = salesDays.find((d) => d.id === dayId);
    if (!day) return;

    let nextItems = items;
    if (day.status === 'completed') {
      nextItems = items.map((item) => {
        const entry = day.items.find((e) => e.itemId === item.id);
        if (!entry || !entry.sold) return item;
        return { ...item, sold: Math.max(0, item.sold - entry.sold) };
      });
    }
    const nextSalesDays = salesDays.filter((d) => d.id !== dayId);
    persistAll(nextItems, events, nextSalesDays);
  }

  function updateSalesDayExtraCosts(dayId, extraCosts) {
    persistSalesDays(salesDays.map((d) => (d.id === dayId ? { ...d, extraCosts } : d)));
  }

  function restoreBackup(data) {
    persistAll(migrateItems(data.items), data.events, data.salesDays);
  }

  function resetAll() {
    persistAll([], [], []);
  }

  if (!authChecked || !dataReady) return <LoadingScreen />;

  return (
    <div
      className="select-none"
      style={{ backgroundColor: BG_COLOR, fontFamily: BODY_FONT, minHeight: '100vh', WebkitTouchCallout: 'none' }}
    >
      <div className="max-w-md mx-auto">
        <div className="sticky top-0 z-40" style={{ backgroundColor: BG_COLOR, paddingTop: 'env(safe-area-inset-top, 0px)' }}>
          <TopBar
            items={items}
            events={events}
            salesDays={salesDays}
            onRestore={restoreBackup}
            onReset={resetAll}
            user={user}
            onSignIn={signInWithGoogle}
            onSignOut={signOutUser}
          />
          <TabBar activeTab={activeTab} setActiveTab={setActiveTab} />
          {saveError && <SaveErrorBanner />}
        </div>
        {canInstall && (
          <div className="px-4 pt-3">
            <button
              onClick={handleInstall}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-green-800 text-white"
            >
              <Download size={14} />
              Install app
            </button>
          </div>
        )}
        {activeTab === 'sales' && (
          <SalesTab
            items={items}
            salesDays={salesDays}
            onSaveDay={saveSalesDay}
            onCompleteDay={completeSalesDay}
            onDeleteDay={deleteSalesDay}
            onUpdateExtraCosts={updateSalesDayExtraCosts}
          />
        )}
        {activeTab === 'inventory' && (
          <InventoryTab items={items} onSave={upsertItem} onSaveMultiple={addMultipleItems} onDelete={deleteItem} />
        )}
        {activeTab === 'calendar' && <CalendarTab events={events} onSave={upsertEvent} onDelete={deleteEvent} />}
      </div>
      {showManualInstall && <ManualInstallModal isIos={isIos} onClose={() => setShowManualInstall(false)} />}
      <KeyboardDismissButton visible={keyboardVisible} onDismiss={dismissKeyboard} />
    </div>
  );
}
