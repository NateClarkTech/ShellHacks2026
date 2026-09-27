import { familiesFor, grantsShield, hardShield, softShield } from "../candidates/tags.js";
import { additiveLand, asEnters, earliestLayer, layerLabel, moonCard, pairKind, pump, setsBase, whenEnters } from "../candidates/layers.js";
import { LAYER_RANK } from "../candidates/tags.js";
import { createClarification } from "../schema/gs.v1.js";

function cardById(candidate, lookup, state) {
  const objects = new Map((state.objects ?? []).map((object) => [object.id, object]));
  return candidate.object_ids.map((id) => {
    const object = objects.get(id);
    const card = lookup(object?.name) ?? {};
    return {
      ...object,
      oracle_text: card.oracle_text ?? "",
      oracle_id: card.oracle_id ?? object.oracle_id,
      type_line: card.type_line ?? object.type_line ?? "",
      tags: card.tags ?? [],
      families: familiesFor({ oracle_text: card.oracle_text ?? "", tags: card.tags ?? [] }),
    };
  });
}

function line(candidate, verdict, oneLiner, citations, depends, headline = candidate.headline) {
  return createClarification({
    candidate_id: candidate.id,
    verdict,
    headline,
    one_liner: oneLiner,
    citations,
    depends_on: depends,
    confidence: verdict === "depends" ? 0.6 : 0.9,
    source_tier: "template",
  });
}

export function timestampMatters(cards) {
  for (let i = 0; i < cards.length; i += 1) {
    for (let j = i + 1; j < cards.length; j += 1) {
      if (pairKind(cards[i], cards[j]) === "same") return true;
    }
  }
  return false;
}

export function resolveTemplate(state, _focus, candidate, lookup) {
  const cards = cardById(candidate, lookup, state);
  if (candidate.shape === "targeting") {
    const shield = cards.find((card) => hardShield(card) || softShield(card) || grantsShield(card));
    if (!shield) return null;
    if (hardShield(shield)) {
      return line(
        candidate,
        "does_not_apply",
        `${shield.name} can't be the target of that spell.`,
        ["cr:702.2c"],
        [],
      );
    }
    return line(candidate, "depends", "It depends on what is being targeted.", [], ["targets"]);
  }
  if (candidate.shape === "replacement_collision") {
    return line(
      candidate,
      "depends",
      "The affected player chooses which replacement effect applies first.",
      ["cr:614.1a"],
      [],
    );
  }
  if (candidate.shape === "damage") {
    return line(
      candidate,
      "depends",
      "These change the same damage. The result depends on the order.",
      ["cr:616.1"],
      [],
    );
  }
  if (candidate.shape === "tax") {
    return line(candidate, "applies", "Pay each cost. One tax does not replace the other.", [], []);
  }
  if (candidate.shape === "layer_order") {
    const first = cards.slice().sort((left, right) => {
      const leftRank = LAYER_RANK[earliestLayer(left)] ?? 99;
      const rightRank = LAYER_RANK[earliestLayer(right)] ?? 99;
      return leftRank - rightRank;
    })[0];
    const second = cards.find((card) => card.id !== first.id);
    const copy = cards.find((card) => (card.families ?? []).includes("layer_copy") || (card.tags ?? []).some((tag) => tag.family === "layer_copy"));
    const typeChange = cards.find((card) => card !== copy && ((card.families ?? []).includes("layer_type") || moonCard(card)));
    if (copy && typeChange) {
      return line(
        candidate,
        "applies",
        `${copy.name} is applied first. ${typeChange.name}'s type change is applied after that copy. Which effect is newer does not change that.`,
        ["cr:613.1d"],
        [],
        `${copy.name} is copied before the type change`,
      );
    }
    return line(
      candidate,
      "applies",
      `${layerLabel(earliestLayer(first))} from ${first.name} is applied before ${layerLabel(earliestLayer(second))} from ${second.name}. Which effect is newer does not change that.`,
      ["cr:613.1d"],
      [],
      `${first.name} is applied first`,
    );
  }
  if (candidate.shape === "enter_split") {
    const replacement = cards.find(asEnters);
    const trigger = cards.find(whenEnters);
    return line(
      candidate,
      "applies",
      `${replacement?.name ?? "One card"} changes how it enters. ${trigger?.name ?? "The other"} waits until it is on the battlefield. They are not the same kind of effect.`,
      ["cr:614.1"],
      [],
      "One changes the entrance, and the other triggers after",
    );
  }
  if (candidate.shape === "legend") {
    return line(candidate, "applies", "Choose one. The other goes to the graveyard.", ["cr:704.5j"], [], "Choose one legend");
  }
  if (candidate.shape === "commander_damage") {
    return line(candidate, "applies", "That player loses the game. Commander damage has to be combat damage from one commander.", [], []);
  }
  if (candidate.shape === "commander_zone") {
    const commander = cards[0];
    return line(
      candidate,
      "depends",
      `${commander.name}'s owner may put it into the command zone when state-based actions are checked. That choice is not available in the middle of the resolving spell.`,
      ["cr:903.9a"],
      [],
    );
  }
  if (candidate.shape === "commander_library") {
    const commander = cards[0];
    return line(
      candidate,
      "depends",
      `If ${commander.name} would go to its owner's hand or library, its owner may put it into the command zone instead. That choice replaces the move.`,
      ["cr:903.9a"],
      [],
    );
  }
  if (candidate.shape === "commander_tax") {
    return line(candidate, "depends", "Tap how many times it was cast from the command zone before.", [], []);
  }
  if (candidate.shape === "regenerate") {
    const shield = cards.find((card) => /regenerate/i.test(card.oracle_text ?? "") || (card.tags ?? []).some((tag) => tag.family === "regenerate"));
    return line(
      candidate,
      "applies",
      `The next time ${shield?.name ?? "it"} would be destroyed this turn, it taps instead, damage is removed, and an attacking or blocking creature is removed from combat.`,
      [],
      [],
      "Destroy is replaced",
    );
  }
  if (candidate.shape === "combat") {
    const name = cards[0]?.name ?? "This creature";
    if (/deathtouch/i.test(candidate.headline)) {
      return line(candidate, "applies", `Any damage ${name} deals to a creature is lethal.`, ["cr:702.2c"], [], `${name} has deathtouch`);
    }
    if (/first strike/i.test(candidate.headline)) {
      return line(candidate, "applies", `${name} deals combat damage in a step before creatures without first strike or double strike.`, [], [], `${name} has first strike`);
    }
    if (/double strike/i.test(candidate.headline)) {
      return line(candidate, "applies", `${name} deals combat damage in the first-strike step and again in the normal step.`, [], [], `${name} has double strike`);
    }
    if (/lifelink/i.test(candidate.headline)) {
      return line(candidate, "applies", `${name}'s controller gains life equal to the damage it deals.`, ["cr:702.15c"], [], `${name} has lifelink`);
    }
    if (/trample/i.test(candidate.headline)) {
      return line(candidate, "depends", "Tap whether it is blocked.", [], []);
    }
  }
  if (candidate.shape === "layer_type") {
    const kind = cards.length === 2 ? pairKind(cards[0], cards[1]) : null;
    if (kind === "moon") {
      const moon = cards.find(moonCard);
      const land = cards.find(additiveLand);
      return line(
        candidate,
        "applies",
        `${moon.name} makes ${land.name} a Mountain and removes its ability. ${land.name} does not turn lands into Swamps, no matter which effect is newer.`,
        land.oracle_id ? [`ruling:${land.oracle_id}`] : [],
        [],
        `${moon.name} removes ${land.name}'s ability`,
      );
    }
    if (kind === "set-then-pump") {
      const setter = cards.find(setsBase);
      const bumper = cards.find((card) => pump(card));
      const bonus = pump(bumper);
      return line(
        candidate,
        "applies",
        `${setter.name} removes creature abilities and sets their base power and toughness to 1/1. ${bumper.name} still gives +${bonus.power}/+${bonus.toughness} after that. A bonus is applied after a power is set, so which effect is newer does not change this.`,
        [],
        [],
        `${bumper.name} still adds to the 1/1`,
      );
    }
    return line(candidate, "depends", "Tap the effect that started later.", ["cr:613.7"], ["timestamps"]);
  }
  return null;
}

export function choicesFor(state, candidate, lookup) {
  const cards = cardById(candidate, lookup, state);
  if (candidate.shape === "commander_tax") {
    return [0, 1, 2, 3].map((times) => ({
      id: String(times),
      label: times === 3 ? "Cast 3 or more times before" : `Cast ${times} time${times === 1 ? "" : "s"} before`,
    }));
  }
  if (candidate.shape === "combat" && /trample/i.test(candidate.headline)) {
    return [
      { id: "blocked", label: "It is blocked" },
      { id: "unblocked", label: "It is not blocked" },
    ];
  }
  if (candidate.shape === "layer_type" && (cards.length !== 2 || !pairKind(cards[0], cards[1]) || pairKind(cards[0], cards[1]) === "same")) {
    return cards.map((card) => ({ id: card.id, label: `${card.name} is newer` }));
  }
  if ((candidate.shape === "replacement_collision" || candidate.shape === "damage") && cards.length >= 2) {
    return [
      { id: cards[0].id, label: `Apply ${cards[0].name} first` },
      { id: cards[1].id, label: `Apply ${cards[1].name} first` },
    ];
  }
  return [];
}

export function resolveChoice(state, candidate, lookup, choiceId) {
  const cards = cardById(candidate, lookup, state);
  const chosen = cards.find((card) => card.id === choiceId);
  const other = cards.find((card) => card.id !== choiceId);
  if (candidate.shape === "commander_tax") {
    const times = Number(choiceId);
    const extra = times >= 3 ? "{6} or more" : `{${times * 2}}`;
    return line(
      candidate,
      "applies",
      `The extra cost is ${extra}.`,
      ["cr:903.9a"],
      [],
      times >= 3 ? "Cast 3 or more times before" : `Cast ${times} time${times === 1 ? "" : "s"} before`,
    );
  }
  if (candidate.shape === "combat" && choiceId === "blocked") {
    return line(candidate, "applies", "It assigns lethal damage to the blocker, and the rest to the defending player or planeswalker.", [], [], "It is blocked");
  }
  if (candidate.shape === "combat" && choiceId === "unblocked") {
    return line(candidate, "does_not_apply", "It is not blocked, so trample does not change where the damage is dealt.", [], [], "It is not blocked");
  }
  if (!chosen || !other) return null;
  if (candidate.shape === "layer_type") {
    return line(
      candidate,
      "applies",
      `${chosen.name} is applied after ${other.name} where they conflict in the same layer. The later effect wins that conflict.`,
      ["cr:613.7"],
      ["timestamps"],
      `${chosen.name} is newer`,
    );
  }
  if (candidate.shape === "replacement_collision" || candidate.shape === "damage") {
    return line(
      candidate,
      "applies",
      `Apply ${chosen.name} first, then ${other.name}.`,
      ["cr:616.1"],
      [],
      `${chosen.name} applies first`,
    );
  }
  return null;
}
