import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {BTC_ADDRESS_RE, EVM_ADDRESS_RE} from './lib/quotes.js';

export default class CotacoesCarteiraPrefs extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    window.set_default_size(580, 640);

    const page = new Adw.PreferencesPage({title: 'Carteira', icon_name: 'dialog-password-symbolic'});
    window.add(page);

    const privacy = new Adw.PreferencesGroup({
      title: 'Segurança',
      description: 'Use apenas endereços públicos. Esta extensão só consulta saldos; nunca cole chave privada nem a frase de recuperação da MetaMask.',
    });
    page.add(privacy);

    const group = new Adw.PreferencesGroup({
      title: 'Carteira',
      description: 'Na MetaMask, clique no nome da conta para copiar o endereço público.',
    });
    page.add(group);

    const validated = (row, re, key, multiple = false) => {
      const check = () => {
        const value = row.text.trim();
        const items = multiple ? value.split(/[,\s]+/).filter(Boolean) : (value ? [value] : []);
        const ok = items.every(i => re.test(i));
        if (ok) row.remove_css_class('error'); else row.add_css_class('error');
        if (ok) settings.set_string(key, multiple ? items.join(', ') : value);
      };
      row.connect('changed', check);
    };

    const evmRow = new Adw.EntryRow({title: 'Endereço da MetaMask (0x…) — procura WBTC e cbBTC', text: settings.get_string('evm-address')});
    validated(evmRow, EVM_ADDRESS_RE, 'evm-address');
    group.add(evmRow);

    const btcRow = new Adw.EntryRow({title: 'Endereço(s) Bitcoin (bc1…), separados por vírgula', text: settings.get_string('btc-addresses')});
    validated(btcRow, BTC_ADDRESS_RE, 'btc-addresses', true);
    group.add(btcRow);

    const wrapped = new Adw.SwitchRow({
      title: 'Procurar BTC embrulhado na MetaMask',
      subtitle: 'Soma WBTC e cbBTC nas redes Ethereum, Base, Arbitrum, Polygon e Optimism.',
      active: settings.get_boolean('scan-wrapped'),
    });
    wrapped.connect('notify::active', () => settings.set_boolean('scan-wrapped', wrapped.active));
    group.add(wrapped);

    const hide = new Adw.SwitchRow({title: 'Ocultar valores da carteira', subtitle: 'Mostra •••• no lugar do saldo e do valor em reais.', active: settings.get_boolean('hide-balance')});
    hide.connect('notify::active', () => settings.set_boolean('hide-balance', hide.active));
    group.add(hide);

    const behaviour = new Adw.PreferencesGroup({title: 'Atualização'});
    page.add(behaviour);
    const refreshRow = new Adw.SpinRow({
      title: 'Atualizar a cada (minutos)',
      adjustment: new Gtk.Adjustment({lower: 1, upper: 60, step_increment: 1, value: settings.get_int('refresh-minutes')}),
    });
    refreshRow.connect('notify::value', () => settings.set_int('refresh-minutes', refreshRow.value));
    behaviour.add(refreshRow);

    const note = new Adw.PreferencesGroup({
      title: 'Sobre o saldo',
      description: 'A MetaMask guarda Ethereum e tokens, como WBTC e cbBTC, que valem 1 BTC cada. Se você usa a conta Bitcoin nativa da MetaMask, cole também o endereço bc1… dela.',
    });
    page.add(note);
  }
}
