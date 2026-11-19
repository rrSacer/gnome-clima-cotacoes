import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {searchCity} from './lib/weather.js';

export default class ClimaGooglePrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window.set_default_size(560, 560);

    const page = new Adw.PreferencesPage({title: 'Clima', icon_name: 'weather-few-clouds-symbolic'});
    window.add(page);

    const place = new Adw.PreferencesGroup({title: 'Local', description: 'Cidade usada para mostrar o clima.'});
    page.add(place);

    const nameRow = new Adw.EntryRow({title: 'Nome exibido', text: settings.get_string('location-name')});
    nameRow.connect('changed', () => settings.set_string('location-name', nameRow.text));
    place.add(nameRow);

    const searchRow = new Adw.EntryRow({title: 'Buscar cidade (Enter para procurar)', show_apply_button: false});
    const status = new Gtk.Label({label: '', xalign: 0, wrap: true, css_classes: ['dim-label'], margin_top: 6});
    searchRow.connect('entry-activated', async () => {
      const q = searchRow.text.trim();
      if (!q) return;
      status.label = 'Procurando…';
      try {
        const results = await searchCity(q);
        if (!results.length) {
          status.label = 'Nenhuma cidade encontrada.';
          return;
        }
        const r = results[0];
        settings.set_string('location-name', r.name);
        settings.set_double('latitude', r.latitude);
        settings.set_double('longitude', r.longitude);
        nameRow.text = r.name;
        latRow.value = r.latitude;
        lonRow.value = r.longitude;
        status.label = `Definido: ${r.name}${r.country ? ` (${r.country})` : ''}`;
      } catch (e) {
        status.label = `Erro na busca: ${e.message}`;
      }
    });
    place.add(searchRow);
    place.add(status);

    const latRow = new Adw.SpinRow({
      title: 'Latitude',
      digits: 4,
      adjustment: new Gtk.Adjustment({lower: -90, upper: 90, step_increment: 0.01, value: settings.get_double('latitude')}),
    });
    latRow.connect('notify::value', () => settings.set_double('latitude', latRow.value));
    place.add(latRow);

    const lonRow = new Adw.SpinRow({
      title: 'Longitude',
      digits: 4,
      adjustment: new Gtk.Adjustment({lower: -180, upper: 180, step_increment: 0.01, value: settings.get_double('longitude')}),
    });
    lonRow.connect('notify::value', () => settings.set_double('longitude', lonRow.value));
    place.add(lonRow);

    const behaviour = new Adw.PreferencesGroup({title: 'Atualização'});
    page.add(behaviour);
    const refreshRow = new Adw.SpinRow({
      title: 'Atualizar a cada (minutos)',
      adjustment: new Gtk.Adjustment({lower: 5, upper: 180, step_increment: 5, value: settings.get_int('refresh-minutes')}),
    });
    refreshRow.connect('notify::value', () => settings.set_int('refresh-minutes', refreshRow.value));
    behaviour.add(refreshRow);
  }
}
