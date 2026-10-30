# Pedigree

A mobile-first dog breeding game. Each season you pair a sire and a dam, pick which pups to keep, and breed toward the dogs your clients want.

Open `index.html` in a browser. There is no build step and there are no dependencies. Progress is saved in `localStorage`.

## The genetics model

- **Mendelian loci**: colour (E/e red, B/b liver, D/d dilute), spotting (S/s flash and piebald), coat length, ears and tail.
- **Polygenic traits**: size, snout length, and four stats (speed, strength, brains, temper). These use additive alleles.
- **Hidden recessive diseases**: hip dysplasia and PRA blindness. A DNA test shows whether a dog is a carrier.
- **Inbreeding**: Wright's coefficient, computed from the pedigree. Higher inbreeding costs health and shrinks litters.
- **Trade-offs**: flat faces hurt health and speed, giants are slow, and toys are fragile.
