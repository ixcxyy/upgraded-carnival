# ═══════════════════════════ CHAPTER 3 · First Jobs (part 1) ═══════════════════════════
# Phase: Scouted. Tech: timers. The move, the office, the cast, the first work order.

=== scene ch3_move
@chapter ch3
@place flat
@location The new flat · Sunday night
! chapter ch3
~ Two rooms, a kitchen the size of a lift, and {a radiator that ticks while it warms up: nine ticks, a pause, nine ticks|c_radiator}.
~ Elias stands in front of it for a minute before he realises he has been counting.
~ He unpacks the kettle, the notebook, four shirts that are the same shirt, and a lab board he probably shouldn't have kept.
~ He checks the stove. It isn't connected yet. He checks it anyway.
! next ch3_day1

=== scene ch3_day1
@chapter ch3
@place lobby
@location %FIRMSHORT% · Lobby, Monday 08:59
~ A glass front on a business park at the edge of %CITY%, between a tile wholesaler and a company that makes industrial scales. Nobody would look at it twice. Nobody is supposed to.
~ Above reception, the square wave folded into an A.
Werner: Voss. You're early.
Elias: One minute.
Werner: Early.
~ The badge has his photo from his student ID, which means someone had his student ID.
Werner: Bench floor, canteen, stores, your bench. Your badge opens those. That one—
~ A red door at the end of the corridor, flush with the wall. A small plate: AREA 2.
Werner: —it does not.
Elias: Yet?
Werner: That's not something I can tell you.
! place area2
! next ch3_bench

=== scene ch3_bench
@chapter ch3
@place benchfloor
@location Bench floor · 09:20
~ Desks and monitors right up against the benches. Scopes, analyzers, ESD mats, a label printer everyone apparently hates. Clean light, no posters. A sign on a cabinet: HANDLE WITH GROUNDING STRAP. NO EXCEPTIONS.
~ Bench 6 is his. It is the cleanest bench on the floor, the way a room is clean when nobody has lived in it for a while. On the shelf edge, {a pale rectangle where a label used to be|c_label}.
Jonas: You're the new one. Jonas. Integration, bring-up. Anything that's supposed to work together and doesn't.
~ Sleeves rolled, an ESD strap still on his wrist, trailing its cable like a leash he has forgotten about. He holds out a paper bag.
Jonas: Pretzel. You look like you skipped breakfast.
Elias: I did.
Jonas: Everyone does on day one. Eat that. Lea's coming, and Lea is a lot on an empty stomach.
Lea: I heard that! Hi! Lea. I do the parties and the birthdays and the badge photos you hate, and I know where everything is, which is honestly the real job.
Lea: Don't tell anyone, but— the coffee machine on this floor has been broken since March and facilities think it's fixed, so don't tell facilities either.
Lea: Oh, you got Bench 6! Nobody's had Bench 6 since— {since the renovation|c_renovation}.
~ The {floor tiles under Bench 6|c_tiles} have the same wear as everywhere else: the same arc scuffed by a chair.
Sina: Bench 1. Sina Kessler. Firmware.
Elias: Elias.
Sina: I know. Hired without a panel.
Jonas: Sina.
Sina: It's an observation. The data suggests it's also a first.
* "What would you have asked me, on a panel?" => ch3_sina_panel
* Let it go. => ch3_sina_letgo
~ Later, he writes "Bench 6" in the notebook, and under it Lea's word, and a question mark.
! open H_G
! open H_F
! next ch3_petra

=== scene ch3_sina_panel
@kind call
Elias: What would you have asked me? On a panel.
Sina: Actually— the standard one. Walk me through a board bring-up, from power-on.
Elias: Measure the rails before the chip. Check the clock before the code. Read the reset table before anything I write. Then the first thing I write toggles a pin, so I know the chain works — clock, mux, direction — before I trust anything more complicated.
~ Sina looks at him a second longer than she needs to.
Sina: That's the answer.
Elias: It's the only answer.
Sina: It's the answer people give after five years. That's the problem.
! stat trust.sina +1

=== scene ch3_sina_letgo
@kind call
~ He lets it go. Sina goes back to Bench 1 and re-solders a joint that looked perfectly fine.

=== scene ch3_petra
@chapter ch3
@place petra_office
@location Petra's office · 11:00
Petra: Sit. Petra Lindqvist. Head of engineering, which mostly means I sign things.
~ Reading glasses pushed up into grey hair. A cup of coffee on the desk with a skin on it. On a stack of folders, a paperweight: {an old circuit board sealed in acrylic|c_paperweight}.
Petra: You'll get your work orders from Werner. They'll tell you what to build and not why. That isn't rudeness. It's policy.
Elias: Need-to-know.
Petra: Need-to-know. {Some of our clients make scales.|c_scales} Some of them make things that aren't scales. You'll start with the scales.
Petra: Off the record, Werner doesn't do onboarding. He's doing yours.
Elias: Why?
Petra: Does it matter, right now?
~ She drinks the cold coffee without noticing that it's cold.
Petra: How's {Anselm|c_anselm}? Still ending everything with riddles?
Elias: Every lab. Every letter.
Petra: Good. Someone should.
! next ch3_aaron

=== scene ch3_aaron
@chapter ch3
@place benchfloor
@location Bench floor · 12:40
~ Bench 5, next to his: a man in a grey jacket eating crackers at his keyboard. Neat desk. Neat handwriting on neat labels.
Elias: Elias. Bench 6.
Aaron: Aaron. Steiner. Hi.
Jonas: Aaron's our test-rig man. If it has a pogo pin, he built it.
Aaron: Jonas exaggerates.
Jonas: Aaron undersells. Lunch?
Aaron: I'm good. {It's fine.|c_aaron_fine} Go ahead.
~ His phone buzzes face down on the desk. He looks at it, doesn't pick it up, and doesn't look away from it either.
! next ch3_wo1

=== scene ch3_wo1
@chapter ch3
@place werner_office
@location Werner's office · Tuesday, 14:00
~ Werner's office is tidier than anything else on the floor: one pen, one pad, one screen, nothing on the walls.
Werner: Your first work order.
~ One printed sheet, slid across the desk. At the top, a field labelled PURPOSE, and nothing in it.
Werner: Before you ask: {J4.7 is not connected. On this one.|c_on_this_one}
Elias: Wait— "on this one."
Werner: That's what I said.
! task 3.1

=== scene ch3_wo1_after
@chapter ch3
@place benchfloor
@location Bench 6 · Tuesday, 17:30
~ The status LED on the CINDER board blinks its pattern: two quick flashes, a long dark. Two quick flashes, a long dark.
? flag:measured_hb | ~ Eighty, one-twenty, eighty, seven-twenty. He doesn't need to measure it. He measured it once already, in pencil, in an exam hall.
? !flag:measured_hb | ~ Something about the rhythm itches, like a word on the tip of his tongue.
Jonas: That's a nice blink. Very reassuring. Very "I'm alive, please don't unplug me."
Elias: It's a heartbeat.
Jonas: ...in people words?
Elias: A signal whose only job is to prove the thing sending it hasn't died.
Jonas: That's what I said.
~ Elias opens the notebook to the page with three answers on it, and draws a line through the first.
Elias: (in the notebook) My applications don't mention NC pins. My exam does.
! demote H_A
! next ch3_cafe1

=== scene ch3_cafe1
@chapter ch3
@place cafe
@location Café Adler · Wednesday, 07:40
~ Jonas's rule, announced on day two: nobody drinks the office coffee, and nobody drinks coffee alone in their first month.
~ Café Adler is a corner with six tables, a chalkboard, and a window full of condensation.
Mira: Jonas. Usual? And — you're new.
Jonas: This is Elias. He's very clever and he doesn't eat.
Mira: Hi, very clever. What can I get you?
Elias: Black coffee. Please.
Mira: Just black?
Elias: Just black.
Mira: Okay. How's your week been? Actually been.
~ She's looking at him while she asks, and she's waiting. People don't usually wait.
* Tell her the truth. => ch3_mira_true
* "Fine." => ch3_mira_fine
~ There's a pencil behind her ear and ink on her fingers, and a sketchbook lies open by the till. On the page: the window, the condensation, a man's hands around a cup.
Jonas: She draws everyone. Don't be flattered. She drew the delivery guy's van.
Mira: The van had character.
! next ch3_wo2

=== scene ch3_mira_true
@kind call
Elias: My new boss read my final exam before he hired me, and the radiator in my flat counts to nine.
Mira: I understood the radiator.
Elias: It ticks nine times, then it pauses.
Mira: That's the most specific complaint anyone's made in here all month. I love it.
! stat warm.mira +1

=== scene ch3_mira_fine
@kind call
Elias: Fine.
Mira: Hm. Okay. Tomorrow, then.
~ She says it as if she's writing down a date.

# ─────────────────────────── ch3 clues, part 1 ───────────────────────────

=== clue c_radiator
@chapter ch3
@volume whisper
@track technical
@decoy
@observation Thermal expansion in a steel radiator. Nine ticks. It's nothing.

=== clue c_label
@chapter ch3
@volume whisper
@track situational
@tags bench6
@supports H_F
@weakens H_G
@observation Adhesive residue in a neat rectangle. A name label, peeled off recently enough that the dust hasn't caught up.

=== clue c_renovation
@chapter ch3
@volume loud
@track situational
@tags bench6
@supports H_G
@observation She stopped, then chose a word: "renovation."

=== clue c_tiles
@chapter ch3
@volume whisper
@track technical
@tags bench6
@weakens H_G
@observation Same tiles, same wear, same chair-scuff arc as every other bench on the floor.

=== clue c_paperweight
@chapter ch3
@volume whisper
@track technical
@tags pattern
@supports H_E H_C
@observation An old prototype sealed in acrylic. A ten-pin header along one edge, marked J4. A U7 footprint.
@observation_if seen:c_j4_exam | An old prototype sealed in acrylic. A ten-pin header marked J4 — the same header as the exam board. A U7 footprint.
@ask Ask what it is => ask_paperweight

=== scene ask_paperweight
@kind call
Elias: The board in the acrylic. What was it?
Petra: Something that worked, once.
~ She moves a folder half across it without looking.
Petra: Does it matter, right now?
! stat susp.petra +1
! device dev_paperweight

=== clue c_scales
@chapter ch3
@volume loud
@track situational
@supports H_D
@observation Scales. Ordinary clients, ordinary things.

=== clue c_anselm
@chapter ch3
@volume murmur
@track situational
@tags brandt
@supports H_C
@weakens H_A
@observation I never mentioned Brandt. She used his first name.
@ask Ask how she knows him => ask_anselm

=== scene ask_anselm
@kind call
Elias: How do you know Professor Brandt?
Petra: Everyone in this business knows everyone, Elias. It's a small business.
~ She pulls her glasses down from her hair and reads something on her screen that doesn't need reading.
! stat susp.petra +1

=== clue c_aaron_fine
@chapter ch3
@volume whisper
@track situational
@tags aaron
@observation Nobody asked him whether anything was wrong.

=== clue c_on_this_one
@chapter ch3
@volume murmur
@track situational
@tags werner pattern
@supports H_C
@weakens H_A
@observation "On this one." As if there had been another one.

# ─────────────────────────── ch3 task 3.1 ───────────────────────────

=== task 3.1
@chapter ch3
@form workorder
@title CINDER
@code WO 7731-02
@rev 3
@board BRD-2210 rev C · %MCU% · 100 MHz
@device dev_2210
@behavior
STATUS_LED blinks: on 80 ms, off 120 ms, on 80 ms, off 720 ms. Repeat. The first blink starts within 20 ms of reset.
Timing derived from CPUTIMER0, ± 0.1 %.
The main loop stays free: it writes DBGCON.TICK at least 1,000 times per second.
@end
@schematic
PB0 ──▶ J2.1   STATUS_LED
J4.1–J4.10     10-pin keyed header
J4.7           NC
U7             DNP
@end
@capture Required waveform
span 0 4000
ch STATUS_LED | hb 0 4000
@end
@remark Pattern per customer specification.
@provided startup.S · link.ld · datasheet · your library
@driver timer_init / timer_expired — a period, a flag, no busy-waiting
@hint1 Jonas: Hey — is the timer block even clocked? Asking because mine never is, the first time.
@hint2 Jonas: Don't count in the loop. Let CPUTIMER0 count. Period register, then watch the flag. What period gives you 10 ms at 100 MHz?
@hint3 Werner: Amendment to WO 7731-02, rev 4. CPUTIMER0 PRD = 999999 gives a 10 ms tick; clear TCR.TSS to start it. Each expiry sets TIF: clear it by writing 1. Sequence: 8 ticks on, 12 off, 8 on, 72 off.
@after ch3_wo1_after
