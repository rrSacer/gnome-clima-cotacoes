import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {fetchWeather, describeCode, weekdayShort, weekdayLong} from './lib/weather.js';
import {destroySession} from './lib/http.js';

const deg = n => `${Math.round(n)}°`;
const pad = n => String(n).padStart(2, '0');

const WeatherIndicator = GObject.registerClass(
class WeatherIndicator extends PanelMenu.Button {
  _init(extension) {
    super._init(0.5, 'Clima');
    this._extension = extension;
    this._settings = extension.getSettings();
    this._cancellable = new Gio.Cancellable();
    this._timerId = 0;
    this._retryId = 0;
    this._retryDelay = 10;
    this._busy = false;
    this._needsRetry = false;
    this._weather = null;

    const box = new St.BoxLayout({style_class: 'clima-panel-box'});
    this._panelIcon = new St.Icon({icon_name: 'weather-overcast-symbolic', style_class: 'system-status-icon clima-panel-icon'});
    this._panelLabel = new St.Label({text: '…', y_align: Clutter.ActorAlign.CENTER, style_class: 'clima-panel-label'});
    box.add_child(this._panelIcon);
    box.add_child(this._panelLabel);
    this.add_child(box);

    this._buildMenu();

    this._settingsIds = ['latitude', 'longitude', 'location-name', 'refresh-minutes'].map(key =>
      this._settings.connect(`changed::${key}`, () => this._onSettingsChanged(key)));

    this._netMonitor = Gio.NetworkMonitor.get_default();
    this._netId = this._netMonitor.connect('network-changed', (_m, available) => {
      if (available && (!this._weather || this._needsRetry))
        this._scheduleRetry(2);
    });

    this._refresh();
    this._schedule();
  }

  _buildMenu() {
    this.menu.box.add_style_class_name('clima-menu');

    this._card = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'clima-card', x_expand: true});
    this.menu.box.add_child(this._card);

    this._buildHeader();
    this._graph = new St.DrawingArea({style_class: 'clima-graph', x_expand: true, height: 70});
    this._graph.connect('repaint', area => this._paintGraph(area));
    this._card.add_child(this._graph);
    this._hoursBox = new St.BoxLayout({style_class: 'clima-hours', x_expand: true});
    this._card.add_child(this._hoursBox);
    this._card.add_child(new St.Widget({style_class: 'clima-separator', x_expand: true}));
    this._daysBox = new St.BoxLayout({style_class: 'clima-days', x_expand: true});
    this._card.add_child(this._daysBox);

    const footer = new St.BoxLayout({style_class: 'clima-footer', x_expand: true});
    this._updatedLabel = new St.Label({text: 'Carregando…', x_expand: true, y_align: Clutter.ActorAlign.CENTER, style_class: 'clima-muted'});
    const refresh = new St.Button({child: new St.Icon({icon_name: 'view-refresh-symbolic', icon_size: 16}), style_class: 'clima-icon-button', can_focus: true});
    refresh.connect('clicked', () => this._refresh());
    const prefs = new St.Button({child: new St.Icon({icon_name: 'emblem-system-symbolic', icon_size: 16}), style_class: 'clima-icon-button', can_focus: true});
    prefs.connect('clicked', () => {
      this.menu.close();
      this._extension.openPreferences();
    });
    footer.add_child(this._updatedLabel);
    footer.add_child(refresh);
    footer.add_child(prefs);
    this._card.add_child(footer);
  }

  _buildHeader() {
    const header = new St.BoxLayout({style_class: 'clima-header', x_expand: true});

    const left = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true});
    this._placeLabel = new St.Label({text: '', style_class: 'clima-place'});
    this._whenLabel = new St.Label({text: '', style_class: 'clima-muted'});
    this._condLabel = new St.Label({text: '', style_class: 'clima-condition'});

    const tempRow = new St.BoxLayout({style_class: 'clima-temp-row'});
    this._bigIcon = new St.Icon({icon_name: 'weather-overcast-symbolic', icon_size: 56, style_class: 'clima-big-icon', y_align: Clutter.ActorAlign.CENTER});
    this._bigTemp = new St.Label({text: '--', style_class: 'clima-big-temp', y_align: Clutter.ActorAlign.CENTER});
    this._bigUnit = new St.Label({text: '°C', style_class: 'clima-big-unit', y_align: Clutter.ActorAlign.START});
    tempRow.add_child(this._bigIcon);
    tempRow.add_child(this._bigTemp);
    tempRow.add_child(this._bigUnit);

    left.add_child(this._placeLabel);
    left.add_child(this._whenLabel);
    left.add_child(this._condLabel);
    left.add_child(tempRow);

    const right = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'clima-details', y_align: Clutter.ActorAlign.CENTER});
    this._rainLabel = new St.Label({text: '', style_class: 'clima-detail'});
    this._humLabel = new St.Label({text: '', style_class: 'clima-detail'});
    this._windLabel = new St.Label({text: '', style_class: 'clima-detail'});
    this._feelsLabel = new St.Label({text: '', style_class: 'clima-detail'});
    for (const l of [this._rainLabel, this._humLabel, this._windLabel, this._feelsLabel])
      right.add_child(l);

    header.add_child(left);
    header.add_child(right);
    this._card.add_child(header);
  }

  _render() {
    const w = this._weather;
    if (!w) return;
    const info = describeCode(w.code, w.isDay);

    this._panelIcon.icon_name = info.icon;
    this._panelLabel.text = deg(w.temp);

    const now = w.fetchedAt;
    this._placeLabel.text = this._settings.get_string('location-name');
    this._whenLabel.text = `${weekdayLong(now)}, ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    this._condLabel.text = info.label;
    this._bigIcon.icon_name = info.icon;
    this._bigIcon.style_class = `clima-big-icon clima-tone-${info.tone}`;
    this._bigTemp.text = String(Math.round(w.temp));
    this._rainLabel.text = `Precipitação: ${w.rain ?? 0}%`;
    this._humLabel.text = `Umidade: ${Math.round(w.humidity)}%`;
    this._windLabel.text = `Vento: ${Math.round(w.wind)} km/h`;
    this._feelsLabel.text = `Sensação: ${deg(w.feels)}`;
    this._updatedLabel.text = `Atualizado às ${pad(now.getHours())}:${pad(now.getMinutes())} · Open-Meteo`;

    this._hoursBox.destroy_all_children();
    w.hours.forEach((h, i) => {
      const hi = i === 0 ? describeCode(w.code, w.isDay) : describeCode(h.code, h.isDay);
      const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: 'clima-hour'});
      col.add_child(new St.Label({text: deg(h.temp), x_align: Clutter.ActorAlign.CENTER, style_class: 'clima-hour-temp'}));
      col.add_child(new St.Icon({icon_name: hi.icon, icon_size: 22, x_align: Clutter.ActorAlign.CENTER, style_class: `clima-tone-${hi.tone}`}));
      col.add_child(new St.Label({text: i === 0 ? 'Agora' : `${pad(h.hour)}h`, x_align: Clutter.ActorAlign.CENTER, style_class: 'clima-muted'}));
      this._hoursBox.add_child(col);
    });

    this._daysBox.destroy_all_children();
    w.days.forEach((d, i) => {
      const di = describeCode(d.code, true);
      const col = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, x_expand: true, style_class: `clima-day${i === 0 ? ' clima-day-today' : ''}`});
      col.add_child(new St.Label({text: i === 0 ? 'hoje' : weekdayShort(d.date), x_align: Clutter.ActorAlign.CENTER, style_class: 'clima-day-name'}));
      col.add_child(new St.Icon({icon_name: di.icon, icon_size: 26, x_align: Clutter.ActorAlign.CENTER, style_class: `clima-tone-${di.tone}`}));
      const t = new St.BoxLayout({x_align: Clutter.ActorAlign.CENTER});
      t.add_child(new St.Label({text: deg(d.max), style_class: 'clima-day-max'}));
      t.add_child(new St.Label({text: deg(d.min), style_class: 'clima-day-min'}));
      col.add_child(t);
      col.add_child(new St.Label({text: d.rain > 0 ? `${d.rain}%` : ' ', x_align: Clutter.ActorAlign.CENTER, style_class: 'clima-rain'}));
      this._daysBox.add_child(col);
    });

    this._graph.queue_repaint();
  }

  _paintGraph(area) {
    const w = this._weather;
    const cr = area.get_context();
    const [width, height] = area.get_surface_size();
    if (w && w.hours.length > 1) {
      const temps = w.hours.map(h => h.temp);
      const min = Math.min(...temps);
      const max = Math.max(...temps);
      const span = Math.max(max - min, 2);
      const n = temps.length;
      const padTop = 22, padBottom = 8;
      const xs = temps.map((_, i) => (i + 0.5) * width / n);
      const ys = temps.map(t => padTop + (1 - (t - min) / span) * (height - padTop - padBottom));

      const fg = area.get_theme_node().get_foreground_color();
      const accent = [0.98, 0.74, 0.02];

      cr.moveTo(xs[0], height);
      cr.lineTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) {
        const mx = (xs[i - 1] + xs[i]) / 2;
        cr.curveTo(mx, ys[i - 1], mx, ys[i], xs[i], ys[i]);
      }
      cr.lineTo(xs[n - 1], height);
      cr.closePath();
      cr.setSourceRGBA(accent[0], accent[1], accent[2], 0.16);
      cr.fill();

      cr.moveTo(xs[0], ys[0]);
      for (let i = 1; i < n; i++) {
        const mx = (xs[i - 1] + xs[i]) / 2;
        cr.curveTo(mx, ys[i - 1], mx, ys[i], xs[i], ys[i]);
      }
      cr.setSourceRGBA(accent[0], accent[1], accent[2], 1);
      cr.setLineWidth(2.2);
      cr.stroke();

      for (let i = 0; i < n; i++) {
        cr.arc(xs[i], ys[i], 3.2, 0, 2 * Math.PI);
        cr.setSourceRGBA(accent[0], accent[1], accent[2], 1);
        cr.fill();
      }
      // Rótulos de temperatura ficam na linha de baixo (colunas das horas); aqui só destacamos o mínimo e o máximo.
      cr.selectFontFace('Sans', 0, 0);
      cr.setFontSize(11);
      cr.setSourceRGBA(fg.red / 255, fg.green / 255, fg.blue / 255, 0.7);
      const iMax = temps.indexOf(max);
      const iMin = temps.indexOf(min);
      const label = (i, t, above) => {
        const text = `${Math.round(t)}°`;
        const ext = cr.textExtents(text);
        cr.moveTo(xs[i] - ext.width / 2, above ? ys[i] - 8 : ys[i] + 16);
        cr.showText(text);
      };
      label(iMax, max, true);
      if (iMin !== iMax) label(iMin, min, false);
    }
    cr.$dispose();
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
    if (!this._weather) this._updatedLabel.text = 'Atualizando…';
    try {
      const lat = this._settings.get_double('latitude');
      const lon = this._settings.get_double('longitude');
      this._weather = await fetchWeather(lat, lon, this._cancellable);
      this._needsRetry = false;
      this._retryDelay = 10;
      this._render();
    } catch (e) {
      if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) return;
      console.error(`[clima-google] ${e.message}`);
      this._needsRetry = true;
      this._updatedLabel.text = this._weather ? 'Sem conexão — mostrando a última leitura' : 'Sem conexão com o serviço de clima';
      if (!this._weather) this._panelLabel.text = '--';
      this._scheduleRetry();
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

  _onSettingsChanged(key) {
    if (key === 'refresh-minutes') this._schedule();
    else this._refresh();
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

export default class ClimaGoogleExtension extends Extension {
  enable() {
    this._indicator = new WeatherIndicator(this);
    const settings = this.getSettings();
    const pos = settings.get_string('panel-position');
    Main.panel.addToStatusArea(this.uuid, this._indicator, 0, pos);
  }

  disable() {
    this._indicator?.destroy();
    this._indicator = null;
    destroySession();
  }
}
