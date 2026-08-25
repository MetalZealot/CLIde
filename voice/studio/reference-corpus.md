# Reference corpus

One passage per class of failure the speech front end fixes. Each case names
what to listen for; the case fails if you hear the wrong column.

The Speech tab loads these by name. Keep them short — a case you can replay
in ten seconds gets replayed.

## Paths and separators

````
The runtime lives at /home/gnuthall/voice, the source is in src/lib/foo.ts,
and your notes are under ~/Projects/x.md.
````

> Listen for: "the home, G NutHall, voice path" — one flowing phrase, not
> spelled letters. No separator word anywhere in the relative path. "home" is
> spoken for the tilde. Nothing swallowed between "the" and "path".

## Markdown structure and pacing

````
## Results

- First point here
- Second point here

This paragraph follows the list.
````

> Listen for: a clear pause after "Results" and between the bullets — longer
> than the pause between ordinary sentences. No heading marks or dashes read
> aloud.

## Identifiers and clock times

````
Run build:client at 3:30pm, then check the 16:9 output at 09:05 and again at
17:00.
````

> Listen for: "build client" as one uninterrupted phrase with no full stop
> inside it, "three thirty p m", "nine oh five", "seventeen hundred". "16:9"
> stays as it is.

## Numbers, money and dates

````
The 1990s shipped 2026-08-24. It cost $1,200.50, up 3.5%, with 3/4 done in
200 ms on port 3001. It took 8.67s.
````

> Listen for: "nineteen nineties", not "nineteen ninety seconds". "August
> twenty fourth, twenty twenty six". "one thousand two hundred dollars fifty
> cents". "three quarters". "three zero zero one" spelled out for the port.

## Pronunciation rules

````
This URL is one of several URLs. The fix is live, the runtime lives here, and
gnuthall owns it.
````

> Listen for: "U R L" as three letters, not "oourl". "live" as in broadcast,
> not as in "I live here" — and "lives" the other way round. "G NutHall".

## Web addresses

````
Open https://example.com/path or https://github.com/OHF-Voice/piper1-gpl for
the details.
````

> Listen for: "example dot com" then the separator word, all in one sentence
> with no hard stops inside the address.

## Symbols and code

````
The flow is input → normalizer → audio ✅

```python
print("this should not be read aloud")
```

Prices rose 50% and C# and 3 * 7 still speak.
````

> Listen for: a short pause where the arrows are, never "right arrow". No
> emoji names. "Code block omitted" once. "C sharp" and the numbers intact.

## A whole reply

````
Both fixed, working tree clean.

The colon rule now only breaks a sentence when a space follows it, so
build:client survives. Relative paths render like absolute ones: src/lib/foo.ts
reads as a path, and no longer depends on the separator word.

- 55 shim tests pass
- Verified live at 21:04 on 2026-08-24

The one thing left is your listening pass.
````

> Listen for: natural rhythm end to end. This is the acceptance case — if this
> one sounds right, the corpus passes.
