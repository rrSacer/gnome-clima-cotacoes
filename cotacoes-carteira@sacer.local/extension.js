import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fetchUsdBrl, fetchBtcUsd, fetchWallet, BTC_ADDRESS_RE, EVM_ADDRESS_RE} from './lib/quotes.js';
import {destroySession} from './lib/http.js';
import {fmt, brl, usd, signed, arrow, tone, timeAgo} from './lib/format.js';

const pad = n => String(n).padStart(2, '0');
const HIDDEN = '••••••';

const QuotesIndicator = GObject.registerClass(
class QuotesIndicator extends PanelMenu.Button {
  _init(extension) {
    super._init(0.5, 'Cotações');
    this._extension = extension;
    this._settings = extension.getSettings();
    this._cancellable = new Gio.Cancellable();
    this._timerId = 0;
    this._retryId = 0;
    this._retryDelay = 10;
    this._needsRetry = false;
    this._usd = null;
    this._btc = null;
    this._wallet = null;
    this._updated = null;
    this._busy = false;

    const box = new St.BoxLayout({style_class: 'cot-panel-box'});
    this._pUsd = new St.Label({text: 'US$ …', y_align: Clutter.ActorAlign.CENTER});
    this._pUsdArrow = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'cot-arrow'});
    this._pSep = new St.Label({text: '·', y_align: Clutter.ActorAlign.CENTER, style_class: 'cot-muted'});
    this._pBtc = new St.Label({text: '₿ …', y_align: Clutter.ActorAlign.CENTER});
    this._pBtcArrow = new St.Label({text: '', y_align: Clutter.ActorAlign.CENTER, style_class: 'cot-arrow'});
    for (const w of [this._pUsd, this._pUsdArrow, this._pSep, this._pBtc, this._pBtcArrow])
      box.add_child(w);
    this.add_child(box);

    this._buildMenu();

    this._settingsIds = ['btc-addresses', 'evm-address', 'scan-wrapped', 'refresh-minutes', 'hide-balance'].map(key =>
      this._settings.connect(`changed::${key}`, () => {
        if (key === 'refresh-minutes') this._schedule();
        else if (key === 'hide-balance') this._render();
        else this._refresh();
      }));

    this._netMonitor = Gio.NetworkMonitor.get_default();
    this._netId = this._netMonitor.connect('network-changed', (_m, available) => {
      if (available && ((!this._usd && !this._btc) || this._needsRetry))
        this._scheduleRetry(2);
    });

    this._refresh();
    this._schedule();
  }

  _card(title) {
    const card = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'cot-card', x_expand: true});
    const head = new St.BoxLayout({style_class: 'cot-card-head'});
    head.add_child(new St.Label({text: title, style_class: 'cot-card-title'}));
    card.add_child(head);
    return card;
  }

  _buildMenu() {
    this.menu.box.add_style_class_name('cot-menu');
    const root = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'cot-root'});
    this.menu.box.add_child(root);

    // Dólar
    this._usdCard = this._card('Dólar → Real');
    this._usdMain = new St.Label({text: '--', style_class: 'cot-main'});
    this._usdChange = new St.Label({text: '', style_class: 'cot-change'});
    this._usdRange = new St.Label({text: '', style_class: 'cot-muted'});
    for (const w of [this._usdMain, this._usdChange, this._usdRange]) this._usdCard.add_child(w);

    // Bitcoin
    this._btcCard = this._card('Bitcoin → Dólar');
    this._btcMain = new St.Label({text: '--', style_class: 'cot-main'});
    this._btcChange = new St.Label({text: '', style_class: 'cot-change'});
    this._btcBrl = new St.Label({text: '', style_class: 'cot-sub'});
    this._btcRange = new St.Label({text: '', style_class: 'cot-muted'});
    for (const w of [this._btcMain, this._btcChange, this._btcBrl, this._btcRange]) this._btcCard.add_child(w);

    const row = new St.BoxLayout({style_class: 'cot-row', x_expand: true});
    row.add_child(this._usdCard);
    row.add_child(this._btcCard);
    root.add_child(row);

    // Carteira
    this._walletCard = this._card('Sua carteira (MetaMask)');
    this._walletBody = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
    this._walletCard.add_child(this._walletBody);
    root.add_child(this._walletCard);

    // Rodapé
    const footer = new St.BoxLayout({style_class: 'cot-footer', x_expand: true});
    this._updatedLabel = new St.Label({text: 'Carregando…', x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'cot-muted'});
    const hide = new St.Button({child: new St.Icon({icon_name: 'view-reveal-symbolic', icon_size: 16}), style_class: 'cot-icon-button', can_focus: true});
    hide.connect('clicked', () => this._settings.set_boolean('hide-balance', !this._settings.get_boolean('hide-balance')));
    const refresh = new St.Button({child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 16}), style_class: 'cot-icon-button', can_focus: true});
    refresh.connect('clicked', () => this._refresh());
    const prefs = new St.Button({child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}), style_class: 'cot-icon-button', can_focus: true});
    prefs.connect('clicked', () => {
      this.menu.close();
      this._extension.openPreferences();
    });
    footer.add_child(this._updatedLabel);
    footer.add_child(hide);
    footer.add_child(refresh);
    footer.add_child(prefs);
    root.add_child(footer);
  }

  _setChange(label, value, text) {
    label.text = text;
    label.style_class = `cot-change cot-${tone(value)}`;
  }

  _render() {
    const usdq = this._usd, btc = this._btc;

    if (usdq) {
      this._pUsd.text = `US$ ${fmt(usdq.price, 2)}`;
      this._pUsdArrow.text = usdq.pct == null ? '' : arrow(usdq.pct);
      this._pUsdArrow.style_class = `cot-arrow cot-${tone(usdq.pct)}`;
      this._usdMain.text = brl(usdq.price, 4);
      if (usdq.pct != null)
        this._setChange(this._usdChange, usdq.pct, `${arrow(usdq.pct)} ${signed(usdq.change, 4)} (${signed(usdq.pct, 2)}%) hoje`);
      else
        this._usdChange.text = 'Variação indisponível';
      this._usdRange.text = usdq.high != null ? `Máx ${brl(usdq.high, 4)} · Mín ${brl(usdq.low, 4)}` : `Fonte: ${usdq.source}`;
    }

    if (btc) {
      const k = btc.price >= 1000 ? `${fmt(btc.price / 1000, 1)} mil` : fmt(btc.price, 0);
      this._pBtc.text = `₿ ${k}`;
      this._pBtcArrow.text = btc.pct == null ? '' : arrow(btc.pct);
      this._pBtcArrow.style_class = `cot-arrow cot-${tone(btc.pct)}`;
      this._btcMain.text = usd(btc.price, 2);
      if (btc.pct != null)
        this._setChange(this._btcChange, btc.pct, `${arrow(btc.pct)} ${signed(btc.change, 2)} (${signed(btc.pct, 2)}%) em 24 h`);
      else
        this._btcChange.text = 'Variação indisponível';
      this._btcBrl.text = usdq ? `≈ ${brl(btc.price * usdq.price, 0)} por BTC` : '';
      this._btcRange.text = btc.high != null ? `Máx ${usd(btc.high, 0)} · Mín ${usd(btc.low, 0)} (24 h)` : `Fonte: ${btc.source}`;
    }

    this._renderWallet();

    if (this._updated) {
      const d = this._updated;
      this._updatedLabel.text = `Atualizado às ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }

  _walletConfigured() {
    return this._btcAddresses().length > 0 || EVM_ADDRESS_RE.test(this._settings.get_string('evm-address').trim());
  }

  _btcAddresses() {
    return this._settings.get_string('btc-addresses').split(/[,\s]+/).map(s => s.trim()).filter(a => BTC_ADDRESS_RE.test(a));
  }

  _row(left, right, rightClass = '') {
    const r = new St.BoxLayout({x_expand: true, style_class: 'cot-line'});
    r.add_child(new St.Label({text: left, x_expand: true, style_class: 'cot-muted'}));
    r.add_child(new St.Label({text: right, style_class: rightClass}));
    return r;
  }

  _renderWallet() {
    this._walletBody.destroy_all_children();
    const body = this._walletBody;

    if (!this._walletConfigured()) {
      const hint = new St.Label({
        text: 'Cole o endereço público da sua MetaMask (começa com 0x) ou um endereço Bitcoin nas configurações. A extensão só lê o saldo; nunca pede chave privada nem frase secreta.',
        style_class: 'cot-sub', x_expand: true,
      });
      hint.clutter_text.line_wrap = true;
      hint.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
      body.add_child(hint);
      const b = new St.Button({label: 'Configurar carteira', style_class: 'cot-button', can_focus: true, x_align: Clutter.ActorAlign.START});
      b.connect('clicked', () => {
        this.menu.close();
        this._extension.openPreferences();
      });
      body.add_child(b);
      return;
    }

    const hidden = this._settings.get_boolean('hide-balance');
    const w = this._wallet;
    if (!w) {
      body.add_child(new St.Label({text: 'Lendo saldo…', style_class: 'cot-muted'}));
      return;
    }

    const rate = this._usd && this._btc ? this._btc.price * this._usd.price : null;
    body.add_child(new St.Label({text: hidden ? `${HIDDEN} BTC` : `${fmt(w.total, 8)} BTC`, style_class: 'cot-main'}));

    if (rate) {
      const valueBrl = w.total * rate;
      body.add_child(new St.Label({text: hidden ? `≈ R$ ${HIDDEN}` : `≈ ${brl(valueBrl, 2)}`, style_class: 'cot-wallet-brl'}));
      if (!hidden)
        body.add_child(new St.Label({text: `${usd(w.total * this._btc.price, 2)} na cotação atual`, style_class: 'cot-muted'}));

      // Variação do valor em reais nas últimas 24 h, usando o preço do BTC e o dólar de 24 h atrás.
      if (this._btc.change != null && w.total > 0) {
        const prevRate = (this._btc.price - this._btc.change) * (this._usd.prev ?? this._usd.price);
        const diff = w.total * (rate - prevRate);
        const pct = (rate / prevRate - 1) * 100;
        const txt = hidden
          ? `${arrow(diff)} ${signed(pct, 2)}% em 24 h`
          : `${arrow(diff)} ${`${diff < 0 ? '-' : '+'}R$ ${fmt(Math.abs(diff), 2)}`} (${signed(pct, 2)}%) em 24 h`;
        const l = new St.Label({text: txt, style_class: `cot-change cot-${tone(diff)}`});
        body.add_child(l);
      }
    }

    // Mudança de saldo desde a última leitura diferente.
    const prev = this._settings.get_double('prev-balance');
    const at = this._settings.get_string('balance-changed-at');
    if (!hidden && prev >= 0 && Math.abs(w.total - prev) > 1e-9) {
      const d = w.total - prev;
      body.add_child(this._row(`Saldo mudou ${timeAgo(at)}`, `${signed(d, 8)} BTC`, `cot-${tone(d)}`));
    }

    const nonZero = w.parts.filter(p => p.amount > 0);
    if (nonZero.length > 1 && !hidden) {
      body.add_child(new St.Widget({style_class: 'cot-separator', x_expand: true}));
      for (const p of nonZero)
        body.add_child(this._row(p.label, `${fmt(p.amount, 8)} BTC`));
    }
    if (w.errors.length) {
      body.add_child(new St.Label({
        text: `⚠ ${w.errors.length} fonte(s) não responderam; o total pode estar incompleto.`,
        style_class: 'cot-down cot-small',
      }));
    }
  }

  _trackBalance(total) {
    const s = this._settings;
    const cur = s.get_double('balance');
    if (cur < 0) {
      s.set_double('balance', total);
    } else if (Math.abs(cur - total) > 1e-9) {
      s.set_double('prev-balance', cur);
      s.set_double('balance', total);
      s.set_string('balance-changed-at', new Date().toISOString());
    }
  }

  _cancelRetry() {
    if (this._retryId) {
      GLib.source_remove(this._retryId);
      this._retryId = 0;
    }
  }

  _scheduleRetry(delaySeconds = null) {
    this._cancelRetry();
    const delay = delaySeconds ?? this._retryDelay;
    this._retryDelay = Math.min(60, Math.max(10, delay * 2));
    this._retryId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delay, () => {
      this._retryId = 0;
      this._refresh();
      return GLib.SOURCE_REMOVE;
    });
  }

  async _refresh() {
    if (this._busy) return;
    this._busy = true;
    this._cancelRetry();
    try {
      const [usdR, btcR] = await Promise.allSettled([fetchUsdBrl(this._cancellable), fetchBtcUsd(this._cancellable)]);
      if (usdR.status === 'fulfilled') this._usd = usdR.value;
      else console.error(`[cotacoes] dólar: ${usdR.reason?.message}`);
      if (btcR.status === 'fulfilled') this._btc = btcR.value;
      else console.error(`[cotacoes] bitcoin: ${btcR.reason?.message}`);
      if (usdR.status === 'rejected' && btcR.status === 'rejected') {
        this._updatedLabel.text = 'Sem conexão — mostrando a última leitura';
        this._needsRetry = true;
        this._scheduleRetry();
      } else {
        this._updated = new Date();
        this._needsRetry = false;
        this._retryDelay = 10;
      }

      if (this._walletConfigured()) {
        try {
          this._wallet = await fetchWallet({
            btcAddresses: this._btcAddresses(),
            evmAddress: EVM_ADDRESS_RE.test(this._settings.get_string('evm-address').trim()) ? this._settings.get_string('evm-address').trim() : '',
            scanWrapped: this._settings.get_boolean('scan-wrapped'),
          }, this._cancellable);
          if (this._wallet.errors.length === 0 && this._wallet.parts.length > 0)
            this._trackBalance(this._wallet.total);
        } catch (e) {
          console.error(`[cotacoes] carteira: ${e.message}`);
        }
      } else {
        this._wallet = null;
      }
      this._render();
    } catch (e) {
      if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
        console.error(`[cotacoes] ${e.message}`);
    } finally {
      this._busy = false;
    }
  }

  _schedule() {
    if (this._timerId) GLib.source_remove(this._timerId);
    const minutes = this._settings.get_int('refresh-minutes');
    this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
      this._refresh();
      return GLib.SOURCE_CONTINUE;
    });
  }

  destroy() {
    this._cancellable.cancel();
    this._cancelRetry();
    if (this._netId && this._netMonitor) this._netMonitor.disconnect(this._netId);
    this._netId = 0;
    if (this._timerId) GLib.source_remove(this._timerId);
    this._timerId = 0;
    for (const id of this._settingsIds) this._settings.disconnect(id);
    this._settingsIds = [];
    super.destroy();
  }
});

export default class CotacoesCarteiraExtension extends Extension {
  enable() {
    this._indicator = new QuotesIndicator(this);
    const pos = this.getSettings().get_string('panel-position');
    const [box, index] = pos === 'center-left' ? ['center', 0]
      : pos === 'center-right' || pos === 'center' ? ['center', -1]
      : [pos, 0];
    Main.panel.addToStatusArea(this.uuid, this._indicator, index, box);
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
    destroySession();
  }
}
