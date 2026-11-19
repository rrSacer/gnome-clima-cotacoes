import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');

const session = new Soup.Session({timeout: 15, idle_timeout: 15, user_agent: 'clima-google-gnome/1.0'});

export function destroySession() {
  session.abort();
}

export async function getJson(url, cancellable = null) {
  const msg = Soup.Message.new('GET', url);
  const bytes = await session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable);
  if (msg.get_status() !== Soup.Status.OK)
    throw new Error(`HTTP ${msg.get_status()} em ${url}`);
  return JSON.parse(new TextDecoder().decode(bytes.get_data()));
}
