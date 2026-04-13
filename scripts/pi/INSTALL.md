# Pi installation — gøres én gang

## Hvad dette gør
Efter installation genstarter Pi'en automatisk AIS-kollektoren ved crash og ved reboot.
Du behøver aldrig SSH ind igen for at genstarte den.

## Find Pi'ens IP (hvis du ikke har den)
Kør dette på din Mac i Terminal:
```bash
arp -a | grep -v incomplete
```
Find den linje der ligner `192.168.x.x` — det er sandsynligvis Pi'en.
Alternativt: log ind på din router (typisk http://192.168.1.1) og se tilsluttede enheder.

## SSH ind og kør bootstrap (kun én gang)
```bash
ssh pi@<IP-ADRESSEN>
```

Når du er inde:
```bash
cd ~/aiss-site/scripts/pi
chmod +x bootstrap.sh
sudo bash bootstrap.sh
```

## Sæt bootstrap til at køre ved hver genstart
```bash
(crontab -l 2>/dev/null; echo "@reboot sleep 10 && bash ~/aiss-site/scripts/pi/bootstrap.sh >> /tmp/bootstrap.log 2>&1") | crontab -
```

## Det er det. Verificer:
```bash
sudo systemctl status ais-ingest
```

Skal vise `active (running)`. Herefter:
- Krasher scriptet → systemd genstarter inden for 10 sekunder
- Pi'en genstarter → bootstrap kører automatisk og starter servicen
- Du modtager email på jacob@jacobkusk.dk hvis ingest stopper i 10+ minutter
