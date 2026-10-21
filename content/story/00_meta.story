# ─────────────────────────────────────────────────────────────────
#  SIGNAL / NOISE — story data, first cut (Chapters 1–4)
#  Plain text. The engine reads this file; nothing in here is code.
#
#  Names marked "placeholder" are open questions in the design doc.
#  Change them here and they change everywhere (%TITLE%, %FIRM% ...).
# ─────────────────────────────────────────────────────────────────

# placeholder: working title
@@title SIGNAL / NOISE
@@subtitle A story about reading hardware, and people.
# placeholder: firm name
@@firm Arnholt Systemtechnik
@@firmshort Arnholt
# placeholder: fictional MCU family
@@mcu K28
# placeholder: the city stays unnamed on purpose
@@city the city
@@start ch1_open
@@player elias
# who signs the work orders, and the channel label on the title card
@@handler W. Albrecht
@@trace J4.7 (NC)

# chapter id | label | title | phase | lore unlocked when it ends
@@chapter ch1 | Chapter 1 | Lab 2.14 | University | doc_exam_notice
@@chapter ch2 | Chapter 2 | The Pins You Think You Own | University | doc_exam_report doc_offer doc_riddles
@@chapter ch3 | Chapter 3 | First Jobs | Scouted | doc_policy42 doc_bench6
@@chapter ch4 | Chapter 4 | Vectors | Scouted | doc_wo_index doc_area2

# ═══════════════════════════ PEOPLE ═══════════════════════════

=== person elias
@name Elias Voss
@short Elias
@role You
Final-year engineering student, early twenties. Reads a device from its waveform before he looks at the schematic. He doesn't choose to notice things; he can't not notice them.
@note flag:measured_hb | Every seventeenth frame, twenty milliseconds short. He has written it down, and can't stop knowing it.
@note flag:went_bar | Stayed out until eleven on a Friday, which is late for him.

=== person brandt
@name Prof. Anselm Brandt
@short Brandt
@role University mentor
Teaches the embedded systems lab. Formal, precise, full sentences even in a two-line note. Ends every lab with a riddle, and every riddle with the same line.
@note stat:trust.brandt>=1 | He answers questions he doesn't have to.
@note flag:brandt_office | He showed me his own final exam. Channel six.
@note flag:asked_mug | I asked about the mug on his windowsill. He turned it to face the window.
@note stat:susp.brandt>=1 | When he won't name someone, he says "people who make things."
@note stat:trust.brandt>=3 | He has decided I'm worth his time. I'm not sure yet that's good news.
@note flag:brandt_worried | He told them I existed. The rest, he says, is what worries him.
@note flag:pattern_sent | I asked who built the exam board. He answered with his sign-off. Only that.

=== person felix
@name Felix Adamek
@short Felix
@role Lab partner
Shares Bench 4. Always one datasheet page behind, and cheerful about it.

=== person werner
@name Werner Albrecht
@short Werner
@role The handler
Delivers every work order. Composed, exacting, a generation older. Punctual to the minute. Never says "I don't know."
@note flag:werner_ring | He turns the ring on his right hand when a conversation gets close to something.
@note stat:susp.werner>=1 | He knows I've been noticing. He hasn't said so. He doesn't have to.
@note flag:werner_eat | He told me to eat something. Jonas told him to tell me.
@note flag:area2_badge | He said the true answer wasn't his to give. For a second he looked sorry.

=== person jonas
@name Jonas Brenner
@short Jonas
@role Colleague · integration and bring-up
Took the new hire under his wing on day one. ESD strap always on, food always nearby, mismatched socks he has never noticed.
@note stat:trust.jonas>=1 | He counts my pretzels. He has decided I'm his problem.
@note flag:jonas_invite | I fixed his level shifter. He invited me to dinner.
@note stat:trust.jonas>=3 | Pasta at his place. A lot of it.
@note flag:asked_bench6 | He knows who sat at Bench 6. "Not my story," he says.

=== person sina
@name Sina Kessler
@short Sina
@role Colleague · firmware
Bench 1. Came up the conventional way and would like that noted. First in, last out, and her tools are arranged by size.
@note stat:trust.sina>=1 | She told me about a clock tree nobody believed was wrong.
@note stat:trust.sina>=2 | Fewer "actually"s this week. Jonas is keeping count.
@note flag:sina_opened | She told me what fast-tracking costs the people standing next to you.
@note flag:sina_proposal | Her shelved proposal. Someone asked for a copy. Nobody told her who.

=== person petra
@name Dr. Petra Lindqvist
@short Petra
@role Head of engineering
Dry, economical, tired in a way that isn't about this week. Reading glasses pushed up into grey hair; a cup of coffee going cold on the desk.
@note stat:susp.petra>=1 | She answers questions with questions. She knows I've noticed.
@note flag:petra_advice | "Don't let Werner make you into a project. He's done it before."

=== person lea
@name Lea Fischer
@short Lea
@role The office hub
Parties, birthdays, badge photos, and everyone's business. Starts most sentences with "Don't tell anyone, but—", including the ones anyone could know.
@note flag:asked_lea_may | Anything I ask Lea, Werner hears by Friday.

=== person aaron
@name Aaron Steiner
@short Aaron
@role Colleague · test rigs
Bench 5. If it has a pogo pin, he built it. Neat desk, neat labels, quiet.
@note tag:aaron>=2 | Steps out for calls. Says "it's fine" to questions nobody asked.
@note stat:susp.aaron>=1 | He knows I heard the call.
@note flag:aaron_told | His mother's care home. Extra work in the evenings — not through Werner.

=== person mira
@name Mira Adler
@short Mira
@role Café Adler
Runs the corner café. Pencil behind her ear, ink on her fingers, a sketchbook by the till. Asks how your day was, and waits for the answer.
@note stat:warm.mira>=1 | She asks about my day, and she waits.
@note stat:warm.mira>=2 | She says grans are usually correct.

# ═══════════════════════════ PLACES ═══════════════════════════

=== place lab214
@name Lab 2.14
@type University
Twelve benches, twelve lab boards, and a whiteboard nobody has fully erased since spring.

=== place exam_hall
@name Exam Hall B
@type University
Forty benches in four rows, and a clock that runs two minutes fast.

=== place corridor
@name Third-floor corridor
@type University
A vending machine, a noticeboard, and nobody buying anything.

=== place brandt_office
@name Brandt's office
@type Privileged · by invitation
Books stacked by colour, not subject. A window that doesn't close all the way.

=== place student_flat
@name Student flat
@type Home
A shared kitchen that smells of someone else's lentils.

=== place flat
@name The new flat
@type Home
Two rooms, a kitchen the size of a lift, and a radiator that counts to nine.

=== place lobby
@name %FIRMSHORT% · Lobby
@type Office
A glass front on a business park, between a tile wholesaler and a company that makes industrial scales.

=== place benchfloor
@name %FIRMSHORT% · Bench floor
@type Office
Desks against benches, scopes against monitors, clean light, no posters.

=== place werner_office
@name Werner's office
@type Office
One pen, one pad, one screen, nothing on the walls.

=== place petra_office
@name Petra's office
@type Office
Folders in stacks, a paperweight, a cold coffee.

=== place area2
@name Area 2
@type Office · badge-gated
A red door, flush with the wall. Your badge doesn't open it.
@note flag:area2_badge | From Monday, it does.

=== place cafe
@name Café Adler
@type Third place · casual
Six tables, a chalkboard, and a window full of condensation.

=== place bar
@name Bar Linde
@type Third place · casual
Low ceiling, dark wood, a jukebox nobody controls.

=== place canteen
@name Canteen
@type Third place · casual
Leaving parties, cake from the good place, a banner that ran out of room.

=== place jonas_flat
@name Jonas's flat
@type Third place · by invitation
Third floor, no lift, a kitchen that is mostly one enormous pot.

=== place dock
@name Loading dock, after hours
@type Third place · private
A door propped open with a fire extinguisher, against at least three rules.

=== place sina_bench
@name Bench 1, after hours
@type Third place · by invitation
The only lit bench on a dark floor.

# ═══════════════════════════ CASE BOARD ═══════════════════════════
# Author-only markers (the player never sees them):
#   @key    a candidate conclusion. The ledger holds it to the rule of three.
#   @trail  a false trail. It may lead for a while; the story breaks it on screen.

=== hypothesis H_A
@question Why me?
@text They found me through one of my applications.
@trail

=== hypothesis H_B
@question Why me?
@text Brandt recommended me. The exam trick was his own.
@key

=== hypothesis H_C
@question Why me?
@text The exam was the firm's test. Brandt ran it for them.
@key

=== hypothesis H_D
@question What am I building?
@text Unrelated jobs for ordinary clients. The firm does a hundred of these.
@trail

=== hypothesis H_E
@question What am I building?
@text Every job is a piece of the same device.
@key

=== hypothesis H_G
@question Bench 6
@text It was just empty. There was a renovation.
@trail

=== hypothesis H_F
@question Bench 6
@text Someone sat at this bench before me, and nobody says their name.
@key

=== hypothesis H_H
@question Who hands out the work?
@text Every job in this building goes through Werner.
@trail

=== hypothesis H_I
@question Who hands out the work?
@text Someone else is handing out work, around Werner.
@key
