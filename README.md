# gnome-clima-cotacoes

Duas extensões para o GNOME Shell (testadas no GNOME 51):

- **clima-google@sacer.local**: temperatura ao lado do relógio e, ao clicar, condição, chuva, umidade, vento, sensação térmica, gráfico de 24 horas e previsão de 7 dias. Usa o Open-Meteo (sem chave).
- **cotacoes-carteira@sacer.local**: cotação de dólar para real e bitcoin para dólar na barra, mais o saldo de bitcoin de uma carteira MetaMask (só leitura, pelo endereço público). Usa fontes gratuitas com reserva.

## Instalação

```sh
cp -r clima-google@sacer.local cotacoes-carteira@sacer.local ~/.local/share/gnome-shell/extensions/
for d in clima-google@sacer.local cotacoes-carteira@sacer.local; do
  glib-compile-schemas ~/.local/share/gnome-shell/extensions/$d/schemas
done
gnome-extensions enable clima-google@sacer.local
gnome-extensions enable cotacoes-carteira@sacer.local
```

Saia e entre de novo na sessão para o GNOME carregar as extensões novas.

## Configuração

- Clima: nas preferências, busque outra cidade.
- Carteira: nas preferências, cole o endereço público `0x…` da MetaMask e/ou os endereços `bc1…` do Bitcoin. Nunca cole chave privada nem frase secreta.
