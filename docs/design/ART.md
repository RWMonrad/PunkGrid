# Kunstkontrakten

Avtalen som gjelder for alt visuelt i appen. Den finnes fordi Metro bare pakker
inn et bilde som kreves med en **bokstavlig** `require`-sti, så hver eneste fil
appen kan vise må stå oppført i `apps/mobile/src/lib/art.ts`. Det er også
regelen som holder kunsten ærlig: en verden viser det bildet regelsettet hennes
faktisk leverer, og et regelsett uten bilde tegner den tekstlige layouten sin
videre. Ingen plassholder-fil, ingen hvit firkant, ingen krakk.

## Slik legges et bilde til

1. Legg filen i `apps/mobile/assets/img/` med navnet i tabellen under (eller et
   nytt navn i samme stil: `kebab-case`, uten versjon eller timestamp).
2. Legg til én linje i `art.ts` — `HEROES['<rulepackId>']` for en
   forside, `PLATES['<location>']` for en placeskive,
   `CAST['<navn>']` for et portrett.
3. Kjør `npx vitest run apps/mobile` (kontrasttesten leser stilarkene sine fra
   kilden) og `npm run walk:device --prefix apps/mobile` etter at bundelen er
   bygget på nytt. Bygget må også kjøre `node scripts/copy-assets.mjs` — uten
   den ligger bildene ikke i `res/`, og en innbygd bundle viser svart der
   kunsten skal være.

Format: **JPEG, quality 78, sRGB, uten metadata** for fotografisk materiale.
Generatorene leverer 1,3–2,7 MB PNG, så hver fil konverteres med én kommando
før den legges i mappen:

```
magick welcome-portal.png -resize 1280x854^ -gravity center -extent 1280x854 -strip -colorspace sRGB -quality 78 welcome-portal.jpg
```

De fjorten filene i mappen veier 26–330 KB hver, hele kunstmappen 1 043 KB
(målt 2026-10-13 med `stat -c %s` på samtlige filer — 1 067 891 byte). PNG står
bare der transpans kreves — ikon og splash er allerede PNG.

## Merket

Logo-en er **ikke** spot-kunst og ligger ikke i `assets/img/`. Originalen er
levert av Rune W. Monrad 2026-10-13 og ligger som den er mottatt i
`docs/design/brand/punkgrid-logo.png` (1254×1254 PNG, 1 596 766 byte, målt).

Det ene unntaket fra regel 3 ligger her, og det er merket selv: ordet
«PUNKGRID» *er* innholdet i bildet, så merket er den eneste fila i prosjektet
som har tekst i seg. Regelen står ellers ved lag — ingen tekst i spot-kunsten,
aldri tekst over kunst — og merket må heller aldri brukes som bakgrunn for
app-tekst, fordi det allerede bærer sin egen.

Bruksområdene er tre, og én av dem er nå byttet ut:

| Hvor | I dag | Merket |
|---|---|---|
| UI01, 48 dp-felt ved siden av ordmerket | `welcome-emblem.png` — levert merke, beskjært til glyfen | byttet inn 2026-10-13 |
| Programikon og splash (`assets/icon.png`, `android-icon-*.png`, `splash-icon.png`, `favicon.png`) | kubemotivet fra `welcome-emblem.png`, skalert per tetthet; monokrom hvit silhuett på transparent for Android adaptive icon | byttet 2026-10-13 |
| `docs/` og alt utenfor appen | — | originalen brukes uendret |

Beskjæringen er ikke den samme kommandoen som for resten av kunsten, og grunnen
er målt: originalen er en *lockup* — kubus, ring, ordmerket «PUNKGRID»,
underlinja «PROCEDURAL MULTIVERSE SIMULATOR» og to HUD-notater øverst. I et
48 dp-felt blir det ene ordet til grøt, og UI01 staver navnet fra før. Derfor
tar feltet bare glyfen: ett firkantet utklip sentrert om kubusen, uten ramme,
uten ord. Kommandoen er skrevet ut slik at den kan kjøres rett fra rota:

```
magick "docs/design/brand/punkgrid-logo.png" -crop 700x700+277+140 +repage -resize 512x512 -strip -colorspace sRGB apps/mobile/assets/img/welcome-emblem.png
```

`welcome-emblem.jpg` (det genererte emblemet fra 2026-10-12) ligger fortsatt i
`assets/img/`, men blir ikke lenger bundlet: Metro tar bare med det `art.ts`
nevner ved navn, og det navnet peker nå på png-en.

Ikonsettet er bygt 2026-10-13 fra kubemotivet: `icon.png` (1024×1024, kube på mørk bakgrunn), `android-icon-foreground.png` (kube på transparent), `android-icon-background.png` (solid #0D1223), `android-icon-monochrome.png` (hvit silhuett på transparent), `splash-icon.png` (512×512) og `favicon.png` (48×48). Android-mipmaps og splash-logoer er regenerert via `npx expo prebuild`.

## Plassene

| Fil | Nøkkel | Hvor den vises | Mål som bygges |
|---|---|---|---|
| `welcome-portal.jpg` | `welcomePortal` | UI01-portalen, UI02-sømmen, F02-forhåndsvisinga | 1280×854, vises i 200/128/120 dp bånd |
| `welcome-emblem.png` | `welcomeEmblem` | UI01-merket ved siden av ordmerket | 512×512, vises i et 48 dp-felt |
| `glass-harbor-hero.jpg` | `glass-harbor-2034` | UI03-premiss, UI04-scenehode, UI07-verdenskort, UI09-historikk | 1280×854, 120/132/168/112 dp bånd |
| `location-singapore.jpg` | `singapore` | UI03 «Where»-skive, UI01-vedheftet | 768×576, 72 dp skive |
| `location-copenhagen.jpg` | `copenhagen` | samme | samme |
| `location-lagos.jpg` | `lagos` | samme | samme |
| `location-mars.jpg` | `mars` | samme | samme |
| `cast-alex-vale.jpg` | `cast['Alex Vale']` | UI03 «Who else is in it»-plate | 512×512, 96 dp plate |
| `cast-mara-venn.jpg` | `cast['Mara Venn']` | samme | samme |
| `cast-ilya-chen.jpg` | `cast['Ilya Chen']` | samme | samme |
| `cast-noor-rahman.jpg` | `cast['Noor Rahman']` | samme | samme |
| `cast-soren-pike.jpg` | `cast['Soren Pike']` | samme | samme |
| `cast-ada-lin.jpg` | `cast['Ada Lin']` | samme | samme |

De fire stedstavlene viser seg også på UI01 under portalbåndet, i en rekke med
navnet under hver plate. Der er de ikke dekorasjon for dekorasjonens skyld: UI01
hadde et tomt felt mellom påstanden og handlingen, og rekken er det svaret på
spørsmålet skjermen egentlig stiller — hva er det livet kan foregå i. Reglene
holder fortsatt: teksten står under bildet, aldri over det, og platene er
`accessibilityElementsHidden`, så de dukker ikke opp i lesetreet. Målt på
enheten 2026-10-13 (`docs/qa/evidence/device-walk/2026-10-13T00-50-32-386Z/UI01
welcome.xml`): fire plater med de fire navnene, og lesetreet sier 16 merkede
noder i den rekkefølgen geometrien gir. Ved 200 % tekst blir rekka to rader —
tre plater foran og Mars bak, med hel label på alle fire og uten ett eneste
klippet tegn — og gangen måler 117/117 på samme skjerm
(`…T01-02-20-705Z`). Det er rullen, ikke layouten, som avgjør hva som får plass
i første viewport: platene ligger under folden på den skalaen, og ett swipe
viser hele rekka.

Historikkskjermen (UI09) fikk båndet sitt 2026-10-13. Denne filen hadde lenge
påstanden at skjermen «får bare episoder, ikke verdens `rulepackId`», og den
påstanden var feil: `GET /v1/worlds/{id}` svarer med `world.rulepackId`
(`core/src/engine.ts:144`, videresendt i `core/src/api.ts:156`), klienten har
hatt `getWorld()` hele tiden (`apps/mobile/src/lib/api.ts:200`), og `heroFor()`
nøkler på nettopp den (`apps/mobile/src/lib/art.ts`, `HEROES`). Det som manglet, var én
lesing til i `history/[worldId].tsx`. Nå heter skjermen «The Glass Harbor» i
stedet for «Episodes», helten ligger i et 112 dp-bånd med hjørnetegn, og
undertittelen lyder `24 committed scenes in The Glass Harbor`. Verdenslesinga er
skilt fra lesinga av listen med vilje: svikter verdensvisningen, blir skjermen
den tekstlige layouten den alltid har vært, mens en feil i selve historikken
får beholde feilpanelet sitt. Målt på enheten 2026-10-13
(`docs/qa/evidence/device-walk/2026-10-13T01-38-52-076Z/UI09 history.xml`):
båndet er der, treet har 18 merkede noder i geometrisk rekkefølge, ti klikkbare
noder har alle navn og er minst 44 dp, og gangen måler 112/112.

### Verdenskortet er plakaten

Båndet på UI07 vaks same dag, og grunnen er eit målt tal, ikkje ein smak: ved 92 dp
var fotografiet 276 px av ei skjerm på 2 992, og det som stod att mellom siste innhald
og footeren, var **1 173 px tom rampe** (`…T04-35-57-978Z`). Ei liste over liv som
sjåast slik ut, er ei tabell med bilete i fyrste kolonne. Høgda er difor 168 dp —
**504 px**, målt som `ImageView`-boksen i treet — fordi fotografiet er det spelaren
kjenner verda att på, og orda under er bildeteksten. Tomrommet på same skjerm er
no 945 px ved 100 % tekst og 574 px ved 200 %, der meta-linja bryt seg over to
linjer; resten er ikkje layout som manglar innhald, det er ein liste på eitt element.
Båndet måler 999 ulike fargar i midtraden ved **begge** skalaer, fordi høgda står i
dp og ikkje i `font` (`…T06-06-44-396Z`, `…T06-19-04-214Z`, og gangen på høvesvis
124/124 og 129/129).

### Besetningen

Portrettrekka på UI03 kom 2026-10-13, og hun løste et problem denne filen hadde
stått med lenge: portrettene sto på vent «til castet nådde klienten», og castet
når aldri klienten — §11 har ingen cast-route, og `/v1/worlds` sier ikke hvem
som finnes i verden. Det viste seg at klienten ikke trenger å få det vite.
`core/src/glassHarbor.ts:44-49` er en fast regelsett-fil, like bounded som de
fire andre listene i `setting.ts`, og premiss, steder, tid og roller blir
allerede fraktet som katalogdata av nøyaktig samme grunn. Castet lagres på samme
måte, med `you` på den samme personen som regelsettet kaller `char_player`.

Prisen er at kopien kan drifte uten at noe merker det, og den prisen er betalt
med en test som leser regelsettet fra disk: `setting.test.ts` sammenlikner navn,
rekkefølge og `isPlayer` med `core/src/glassHarbor.ts` i begge retninger, og
krever at hvert navn har en portrettfil i `assets/img/`. En ny figur i
regelsettet som ikke får en plate, eller en klient som finner på en, går rødt.

Layouten ble ikke den første som ble bygget. Første utgave fulgte «Where»-raden
over og la seks plater i en vannrett rullbar rekke, og målingen er den samme
skjermen gjorde: ved 100 % tekst fikk plass til fire plater, den fjerde ble kutt
midt i et navn av panelkanten — «Noor Rahm» — og de to siste fantes bare for den
som tenkte å swipe sidelengs. En besetning man må oppdage, er ikke en
besetning. Rekka er derfor et rullet felt med faste celler (116 dp), tre plater i
bredden og to rader på denne enhetens 393 dp panelbredde, og tekst som brytes i
cella i stedet for å skyve raden fra hverandre. Målt på ei ramme der gangen hadde
rullet fram til rekkja, er platene 285 px — 95 dp — og ei rekke av tre spansker
x=120..1173 av skjermens 1 344
(`docs/qa/evidence/device-walk/2026-10-13T04-35-57-978Z/UI03 setup — cast.xml`).

Hver plate er dessuten **én** tilgjengelighetsnode, ikke to. Android går ei
plates rekke etter geometri, så den udelte versjonen kunngjorde alle navnene og
alle rollene etter hverandre — «Alex Vale · you, Mara Venn, Ilya Chen, Noor
Rahman, Founder / CEO, Co-founder, Investor, …» — som to lister og ingen
par. Sammenslåingen legger ikke til ett ord; den holder sammen på det som
allerede står der. Kunsten er fortsatt ute: `ArtMark` skjuler seg selv, og
labelen er appens egen tekst, aldri ei skildring av eit bilete (regel 1).

Sammenslåingen flyttet også på målingen. Navnet under ei plate kommer nå tilbake
som innholdsbeskrivelse, og den noden har `y1` lik platens egen topplinja, så
midtraden mellom overskrifta og den første plata landet i luften over kunsten —
36 px over platene på UI01 — og teller éi farge. Det er hva gangen målte 2026-10-13
(`2026-10-13T03-24-06-150Z`), der begge skiverekkene gikk røde av nøyaktig denne
årsaken. De to platerekke-slotene måler seg derfor mot platenes egne `ImageView`-noder
i steden for mot gapet rundt dem; tallene målinga gir, står under.

### Kunsten måles på pixler

Regel 1 er årsaken til at kunsten trenger en egen målemetode: ingenting i
tilgjengelighetstreet kan si om en bildefil *ankom*, og den kjente feilen i
leveranseloopen er nøyaktig den — en bundle bygget uten `scripts/copy-assets.mjs`
viser en flat plate der kunsten skulle vært. Enhetsgangen leser derfor
skjermbildet det nettopp skrev, og teller ulike farger i beltet kunsten skal
fylle. Målt på denne enheten ved begge tekstskalaer holder en rad over et
fotografi **750–1 009** ulike farger, mens en rad over en flat plate holder
**nøyaktig 1**. Grensen står på **64**, fordi de to svarene ligger tre
størrelsesordener fra hverandre, og en halvlest skjerm skal komme tilbake rød.
Merket ved siden av ordet «PunkGrid» måler 12 123 farger på 1,0 og 12 478 på 2,0,
så samme tall dekker det også.

Beltet står i treet som en node uten navn — en `ImageView` uten tekst — så plassen
bestems av nodene som rammer det inn: midtraden mellom bunnen av noden over og
toppen av noden nedenfor. Sjølve båndene er målt til **336–600 px** på denne enheten
(UI09-historikken 336, UI03-premissen og F02-portalen 360, UI02-sømmen 384,
UI04-scenehodet 396, UI07-verdenskortet 504, UI01-portalen 600), og tallene er
**de samme pixlene ved begge tekstskalaer**, fordi høyda står i dp og ikke i `font`.
Luften mellom beltet og nodene som rammer det inn, er målt til 45–96 px på hver side,
så midtpunktet ikke kan lande utenfor uten at layouten har endret seg — og det er en
slik endring målingen er laget for å fange. De to platerekkene har ikke en node under
seg å ramme inn mot, fordi ei slått sammen plate starter der kunsten starter, og
måler seg derfor mot biladenes egne
noder: unionen av de oppreiste `ImageView`-boxene i den øverste rekkja under
overskrifta. Det gir ei rekke på fire 213 px-plater og 78 790 farger på UI01 ved 100 %
tekst (tre av de fire platene er inne i bildet ved 200 %, og gir 58 068), og tre 285
px-portretter og 86 695 farger på UI03 ved begge skalaer — portrettene skalerer ikke med
teksten, fordi cellene er faste.

Tre bånd er ikke innenfor første viewport: platerekken på UI01
ligger under folden ved 200 %, besetningsrekka på UI03 gjør det samme ved begge
skalaer, og gjestekonsekvensen kommer tilbake fra et valg rullet forbi
sitt eget hode. Påstanden handler om at filen ankom, ikke om folden, så gangen
ruller til beltet og fotograferer den rammen under slotens eget navn
(`UI01 welcome — plates`, `UI03 setup — cast`, `F02 guest consequence — portal`). Et bånd som aldri
kommer tilbake, feiler sin egen sjekk i stedet for å tie.

For platerekka er rullinga målt, ikke antatt: ei node skjermen har klippet, rapporterer
**inverterte** bounds — besetningsrekka kom tilbake som `[120,2855][405,2713]` i rammen
der gangen tidligere stoppet for tidlig — så `plateRow` godtar bare oppreiste bokser.
Det betyr at gangen ruller videre til rekka virkelig er inne i bildet, i stedet for å
fotografere folden og kalle den en flat plate.

Målingen bor i `apps/mobile/scripts/lib/art-check.mjs` (slot-tabellen, grensen og
ordlyden) og `lib/png.mjs` (en avkoder skrevet for hånd, uten avhengigheter, som
avviser alt som ikke er 8-bits, ikke-interlaced og uten palett). Begge kalles av
`scripts/device-walk.mjs` på enheten og av `scripts/art-check.test.mjs` på
bevismaterialet som allerede ligger på disk. Den siste filen er grunnen til at
tabellen ikke står i gangen: to kalere, én liste av påtaler, slik at et slot ikke
kan telles i den ene og glemmes i den andre.

To plasser står igjen og er **med vilje tomme** inntil videre:

* **UI10 (konto)** — mockupene brukeren leverte 2026-10-12 viser en
  *karakter*profil med portrett, alder og målere, mens denne skjermen i dag er
  personvern. Det er et designvalg, ikke et bildevalg.
* **Bevegelse** — se nederst.

## Reglene kunsten må følge

1. **Kunsten er dekorativ.** `ArtBand` setter `accessibilityElementsHidden`, og
   påstanden et bilde bærer står alltid i teksten ved siden av. Dermed endrer
   ikke kunsten på accessibility-treet enhetsgangen måler.
2. **Aldri tekst oppå et bilde.** Et scrim over et fotografi kan ikke måles i
   `contrast.test.ts`, så alle båndene har teksten *under* seg. Et bilde som
   inneholder lesbar tekst, ville krevd at kontrasttesten målte mot pikseldata,
   og det er ikke en gevinst verdt bryet.
3. **Ingen tekst i bildet.** Ingen signage, ingen logo, ingen vannmerke. Ord i
   et bilde kan ikke oversettes, ikke skaleres og ikke leses opp.
4. **Fiksjon, ikke gjenkjennbare personer.** Portretter må ikke kunne pekes ut
   som en ekte person — det er innholdspolitikken vår, og `real_person` er en
   av rapportårsakene i UI-årsaksskjemaet.
5. **Paletten er vår, ikke modellens standardvalg.** Ink `#0D1223`, overflate
   `#18213A`, violet `#A58BFA`, cyan `#70D8EB`. Hver prompt slutter med den
   paletten, og det er grunnen til at seks bilder fra to generatorer kan henge
   sammen på én skjerm.

## Promptene som ligger bak filene i dag

Disse er brukt 2026-10-12 med den innebygde bildegeneratoren, og de er
reproduserbare: samme prompt gir samme bilde, og en ny generasjon kan
sammenlignes med filen som allerede finnes.

```
welcome-portal.jpg (1536×1024)
Cinematic still, near-future noir. A narrow vertical seam of cyan light
splitting a wall of dark polished glass, as if one reality is opening into
another. Faint reflections of a city that is not this one visible inside the
seam. Palette: deep ink-blue #0D1223 shadows, violet #A58BFA and cyan #70D8EB
accent light, muted steel #24314E midtones. Volumetric haze, subtle film grain,
high contrast, moody, minimal composition with empty dark space in the lower
third for text overlay. No text, no letters, no logos, no watermarks.
```

```
welcome-emblem.jpg (1024×854)
Minimal geometric emblem floating in dark space: a small cube of cyan light at
the centre, ringed by one thin violet orbit and four open corner brackets, like
a targeting reticle drawn on polished night glass. Faint lattice lines fading
into the background. Palette: deep ink-blue #0D1223 field, cyan #70D8EB core,
violet #A58BFA ring. High contrast, crisp edges, generous empty margin on every
side so the mark can be cropped freely. No text, no letters, no logos, no
watermarks.
```

Generatoren leverte merket 1024×1536 med platen i øvre halvdel, så filen som
liggj i mappen er skoren ut rundt sjølve merket og skalert til kvadrat:

```
magick welcome-emblem_…png -crop 470x470+277+396 +repage -resize 512x512 -strip -colorspace sRGB -quality 78 welcome-emblem.jpg
```

Uten skaret forsvant merket i ei 48 dp-plate på skjermen: heile biletet er
mørkt nok i utgangspunktet, og eit lite utsnitt av midten av det er det som
lyser. Målt 2026-10-12 på UI01.

```
glass-harbor-hero.jpg (1536×1024)
Cinematic wide aerial still at dusk: an alternate Singapore harbour in 2034.
Automated logistics terminals, glass-and-steel control towers, electric crane
barges and autonomous freight ferries on dark water, rain-slick quays, dense
city skyline behind. Mood: dry, tense, near-future noir, corporate mystery.
Palette: deep ink-blue #0D1223 shadows and sky, cyan #70D8EB and violet
#A58BFA accent lighting, warm sodium highlights kept sparse. Volumetric haze
over the harbour, reflections on wet surfaces, film grain, high contrast.
No text, no readable signage, no logos, no watermarks.
```

De fire placeskivene deler én mal, der bare stedet byttes ut:

```
location-<value>.jpg (1024×768)
Cinematic still, near-future noir, 2034. <SETNING OM STEDET>. Palette: deep
ink-blue #0D1223 shadows, cyan #70D8EB and violet #A58BFA accent lighting,
sparse warm highlights. Volumetric haze, film grain, high contrast, no people
in focus. No text, no readable signage, no logos, no watermarks.
```

* `singapore` — «A dense automated deep-sea port in an alternate Singapore:
  gantry cranes in rows, stacked container blocks, a glass transit spine and
  elevated guideways, monsoon-wet concrete reflecting the yard lights,
  equatorial haze.»
* `copenhagen` — «An alternate Copenhagen waterfront: canals between brick and
  glass warehouse conversions, bicycle bridges with a subtle solar canopy line,
  offshore wind turbines on the dark horizon, low winter dusk light on wet
  stone.»
* `lagos` — «An alternate Lagos coastal megacity seen across the lagoon: layered
  skyline of new towers rising over dense older districts, drone corridors
  marked by faint light lanes, ferry traffic on dark water, humid heat
  shimmer.»
* `mars` — «A small Mars settlement at blue dusk, alternate history: pressurized
  habitat modules connected by covered walkways, dusty rust regolith in the
  foreground, a low sun haze on the horizon, faint violet aurora in a dark sky,
  harsh artificial light spilling from portholes.»

De seks portrettene deler én mal — samme palett, samme kamera, samme
«fiktiv karakter, ikke et fotografi av en gjenkjennbar person»-setning — og bare
rollen, alderen og anledningen byttes ut. Malen er ikke bare estetikk: regel 4
(ingen ekte person) og regel 2 (ansikt som tåler å bli kuttet til en firkant)
er begge løst i teksten som går foran motivet.

```
cast-<navn>.jpg (1024×1024, bygges som 512×512)
Cinematic character portrait, near-future noir, 2034. <MOTIV>. Palette: deep
ink-blue #0D1223 shadows, cyan #70D8EB rim light, violet #A58BFA accent glow,
sparse warm sodium highlights. Volumetric haze, subtle film grain, high
contrast, shallow depth of field, shoulders-up three-quarter view, face lit but
partly in shadow. Fictional character illustration, not a photograph of any
identifiable real person. No text, no letters, no logos, no watermarks.
```

* `alex-vale` — «A company founder in their late thirties, standing in a dark
  glass-and-steel tower lobby at night, calm and guarded expression, simple dark
  technical jacket. Behind them a blurred wall of rain-slick windows with cyan
  control lights.»
* `mara-venn` — «A co-founder of a logistics company: a stocky, broad-shouldered
  woman in her early thirties with very short cropped auburn hair, freckled ruddy
  skin, a chipped thumbnail and a weathered canvas work vest over a
  sweat-darkened tee, standing on a rain-slick quay at dusk with blurred
  automated gantry cranes behind her. Tired but steady expression, jaw set.»
* `ilya-chen` — «An investor in his fifties, seated in a dark private lounge with
  polished black surfaces, immaculate dark suit, unreadable and patient
  expression, one hand resting on the table edge.»
* `noor-rahman` — «An investigative journalist: a tall, lean woman in her late
  fifties with deep-set laugh lines and close-cropped silver-grey hair, a long
  rain-spotted wool coat and a small field recorder clipped at her collar,
  standing on a wet overpass at night with blurred autonomous ferries on dark
  water behind her. Attentive, direct expression, one eyebrow raised as if she is
  already writing the sentence.»
* `soren-pike` — «A corporate acquisition negotiator, man in his forties, at the
  edge of a container terminal with blurred electric crane barges behind him,
  composed and courteous expression that does not reach the eyes, fine dark
  coat.»
* `ada-lin` — «An operations director, woman in her forties, inside a harbour
  control tower with blurred dark console screens and cyan data glow behind her,
  practical and watchful expression, simple work shirt with a lanyard.»

De to første utgavene av `mara-venn` og `noor-rahman` ble forkastet: generatoren
la to kvinner i førtiårene i samme svart, kortklippet frakke, og på ei 96
dp-plate — 288 px — var det samme ansiktet to ganger. Det er ikke en smakssak;
castet *er* informasjonen på skjermen, og to personer som leses som én
person gir en falskere setning enn en rekke uten bilder. De to motivene ble
derfor skrevet om med alder, kroppsbygning, hår og antrekk som ikke kan
forveksles, og første utgave ligger igjen i `.scratch/` som `cast-*-v1.png`,
sammen med montasjen de ble vurdert i; den mappa er lokalt arbeid og står ikke
i git.

## Bevegelse — det jeg ikke kan generere

Jeg lager stille bilder. Video og animerte løk kan jeg ikke, så disse er skrevet
for at du kan generere dem et annet sted. **Legg filene i
`apps/mobile/assets/img/` med navnene under**, så kobler jeg dem i `art.ts` og
bygger dem inn.

Formatavtale for bevegelse: `.mp4`, H.264, 3–6 sekunder, **sømløs løkke** (første
og siste frame like), 24–30 fps, maks 400 KB per fil, uten lydspor. Bevegelsen
må tåle §5.5: `useReduceMotion` bytter løkken tilbake til stillbildet med samme
navn (`welcome-portal.mp4` → `welcome-portal.jpg`), og ingen løk får inneholde
raske klipp, rask panorering eller bevegelse opp og ned over hele bildet.

```
motion-portal-loop.mp4  (erstatter welcome-portal.jpg på UI01, 1280×854, 4 s)
Seamless loop, 4 seconds, locked camera. The vertical seam of cyan light in a
dark glass wall breathes: the glow widens by about eight percent and returns,
thin haze drifts slowly sideways through the light, and the reflections of the
other city inside the seam shift almost imperceptibly. Nothing else moves.
Palette: deep ink-blue #0D1223, violet #A58BFA, cyan #70D8EB. Cinematic, film
grain, no text, no logos, no watermarks, no cuts.
```

```
motion-harbor-loop.mp4  (glass-harbor-hero.jpg på UI04, 1280×854, 6 s)
Seamless loop, 6 seconds, slow lateral push across a rain-slick automated
harbour at dusk in an alternate Singapore 2034. Water moves under the quay,
one crane barge crosses the frame left to right and exits, harbour lights
flicker once, low haze drifts. Camera drift is under five percent of frame
width so the loop closes. Palette: deep ink-blue #0D1223, violet #A58BFA,
cyan #70D8EB. Near-future noir, film grain, no text, no logos, no watermarks.
```

```
motion-scene-transition.mp4  (episodeovergang, 720×1280, 2 s)
Seamless 2-second transition: a dark glass surface fills the frame, a cyan
violet light sweep travels once across it from left to right and leaves the
surface clear. Nothing else changes. Deep ink-blue #0D1223 base, cyan #70D8EB
leading edge, violet #A58BFA trailing edge, film grain, no text, no logos.
```

Portrettene kan jeg lage selv, men de kommer sist: de krever at castet blir
utlevert til klienten først (punktet over). Malen står her likevel, slik at du
kan kjøre dem i samme lys og palett som resten hvis du vil ha dem nå. Merk at
navnene er testkonstanter fra §12, ikke personer:

```
portrait-<navn>.jpg (1024×1024)
Cinematic bust portrait, near-future noir, alternate Singapore 2034. <BESKRIVELSE>.
Lit from one cyan source at frame left and one violet rim at frame right, deep
ink-blue #0D1223 background, wet reflections on the skin, shallow depth of
field, calm direct gaze, film grain. Fictional character, not resembling any
real person. No text, no logos, no watermarks.
```
