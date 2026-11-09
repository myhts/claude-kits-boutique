# Test 1: raw output of the claude-kits tools

From [claude-kits `kit-check/explorer-eval/`](https://github.com/myhts/claude-kits/pull/9), on 2026-11-09, at commit `c7cb6d5b`. The page that explains it is [01-who-reads-the-code.md](../../01-who-reads-the-code.md).

## The survey each run wrote (`score.mjs`)

```text
arm      entry points  calls   stores  refs (broken)  unsure  calls not in key (to the app / outside)
opus     23/23         14/14   1/1     118 (0)        48      0 / 22
sonnet   23/23         14/14   1/1     85 (0)         40      0 / 5
haiku    23/23         14/14   1/1     79 (0)         11      0 / 3
sonnet2  23/23         14/14   1/1     94 (0)         48      0 / 9
haiku2   23/23         14/14   1/1     83 (0)         9       0 / 3
```

## The readers' own fact sheets, before the main session checked them (`sheets.mjs`, then `score.mjs`)

```text
arm      entry points  calls   stores  refs (broken)  unsure  calls not in key (to the app / outside)
opus     23/23         14/14   1/1     143 (0)        71      0 / 25
sonnet   23/23         14/14   1/1     98 (0)         48      0 / 10
haiku    23/23         14/14   1/1     69 (1)         5       0 / 4
sonnet2  23/23         14/14   1/1     106 (0)        61      0 / 10
haiku2   23/23         14/14   1/1     84 (0)         3       0 / 4

broken: loadgenerator → frontend: src/loadgenerator/locustfile.py:35,39,43,46,51,56,61,75 (no line number)
```

## Usage per run at list price (`usage.mjs`)

On a Claude Max plan nothing extra is billed; list price is the fair way to compare runs.

### opus-1

```text
model                        input   cache write    cache read      output   list price
claude-opus-5-5                160       365,565     2,782,144      68,200   $4.0203
claude-haiku-4-5-20251001    1,494             0             0          12   $0.0016
total at list price: $4.0218
```

### sonnet-1

```text
model                        input   cache write    cache read      output   list price
claude-opus-5-5                 36        71,049     1,151,485      27,764   $1.3541
claude-sonnet-5-5               76       180,983       512,358      17,619   $0.7313
claude-haiku-4-5-20251001    1,495             0             0          14   $0.0016
total at list price: $2.0869
```

### sonnet-2

```text
model                        input   cache write    cache read      output   list price
claude-opus-5-5                 40        88,673     1,476,894      30,768   $1.6203
claude-sonnet-5-5               86       199,332       590,456      21,517   $0.8318
claude-haiku-4-5-20251001    1,495             0             0          12   $0.0016
total at list price: $2.4536
```

### haiku-1

```text
model                        input   cache write    cache read      output   list price
claude-opus-5-5                 50        73,230     1,591,175      25,351   $1.4113
claude-haiku-4-5-20251001    2,639       222,106     2,439,813      41,686   $0.7327
total at list price: $2.1440
```

### haiku-2

```text
model                        input   cache write    cache read      output   list price
claude-opus-5-5                 64        80,225     2,313,147      29,259   $1.6899
claude-haiku-4-5-20251001    2,751       271,867     3,040,546      60,502   $0.9491
total at list price: $2.6390
```
