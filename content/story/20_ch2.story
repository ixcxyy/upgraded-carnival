# ═══════════════════════════ CHAPTER 2 · The Pins You Think You Own ═══════════════════════════
# Phase: University. Tech: muxing, polling, and the exam board with the planted anomaly.
# The hidden test: J4.7 is marked NC and isn't. Elias notices it on the main path regardless;
# clicking it (and measuring) is what the later chapters remember.

=== scene ch2_open
@chapter ch2
@place lab214
@location Lab 2.14
! chapter ch2
Brandt: Last week you told pins what to do. This week you will discover that some of them were never yours.
Brandt: At power-on, PB6 belongs to the clock-output block. I would like a hundred-kilohertz reference on it, so leave it where it is and configure its owner. PB2 belongs to the timer, which you have not earned yet. Take it back.
Felix: Wait. We un-mux one and leave the other one muxed?
Elias: Borrow one. Return one.
! task 2.1

=== scene ch2_t1_after
@chapter ch2
@place lab214
@location Lab 2.14
Brandt: Good. Now make it busy.
Brandt: PA0 still drives the LED on PB2, inside two microseconds. Meanwhile PA1 receives pulses — some as short as three microseconds — and I want a running count on PB8 to PB11. Miss one and the count is wrong forever.
Felix: Two things at once? Without interrupts?
Brandt: Without interrupts. You will learn to love them by first learning to need them.
! task 2.2

=== scene ch2_t2_after
@chapter ch2
@place lab214
@location Lab 2.14 · the last lab before the exam
Brandt: The practical exam is on Thursday. You will receive a board you have not seen, a sheet you have not read, and three hours.
Brandt: The boards are on loan, so treat them kindly.
Felix: On loan from who?
Brandt: From whom. And from people who make things.
~ He writes the week's riddle on the whiteboard, under last week's. The old derivation is almost gone now.
Brandt: {Why does a careful engineer label a pin "not connected," instead of simply leaving it unlabelled?|c_riddle_nc}
Brandt: Mind the signal under the noise.
! next ch2_night

=== scene ch2_night
@chapter ch2
@place student_flat
@location Student flat · the night before
~ Elias checks the stove. Then the window latch. Then the stove.
Felix [text]: what do u think the trick is
Elias [text]: What trick?
Felix [text]: brandt ALWAYS puts a trick in the final. last year a {diode was in backwards|c_felix_trick}. year before the button was active low and the sheet said high
Elias [text]: Then read the board, not the sheet.
Felix [text]: that's literally the trick every year and it gets me every year
~ He sleeps four hours, which is enough.
! next ch2_exam

=== scene ch2_exam
@chapter ch2
@place exam_hall
@location Exam Hall B · Thursday, 09:00
~ Forty benches in four rows. The boards are new — green, not the lab's blue — with a {ten-pin header marked J4|c_j4_exam} along one edge.
~ Brandt walks the rows. At the back of the hall, a {man in a pressed shirt|c_man_exam} sits with his hands folded. He isn't proctoring. He isn't grading. He is watching the benches.
Brandt: Three hours. The sheet describes a pedestrian crossing. The board is the crossing. Begin.
! task 2.3

=== scene ch2_t3_after
@chapter ch2
@place exam_hall
@location Exam Hall B · 11:52
~ Elias finishes with an hour to spare. He writes the report. Then, at the bottom, one more line.
? flag:measured_hb | ~ He adds the numbers: eighty, one-twenty, eighty, seven-twenty milliseconds. A one-second frame. And every seventeenth frame, twenty milliseconds short.
? !flag:measured_hb | ~ He never stopped to measure it. He saw it out of the corner of his eye in the first ten minutes, and it has sat there ever since, like a stone in a shoe.
Elias: (in the margin, in pencil) J4.7 is marked NC. It is not NC.
~ When he hands the sheet in, Brandt reads the last line first. Then he reads it again.
~ At the back of the hall, the man in the pressed shirt {stands up and leaves|c_man_leaves}.
! next ch2_after_exam

=== scene ch2_after_exam
@chapter ch2
@place exam_hall
@location Exam Hall B · after
Brandt: Mr. Voss. Stay a moment.
~ The hall empties. Brandt sits on the edge of a bench, which Elias has never seen him do.
Brandt: How long did it take you?
Elias: To notice? About ten minutes. It was in the corner of the capture.
Brandt: In thirty-one years, four students have written that sentence. Four.
Elias: It was there.
Brandt: Yes. And thirty-six other people in this room were busy with the crossing, doing exactly what they were asked.
~ He says it like a compliment to them and a warning to Elias, at the same time.
Elias: Is that bad?
Brandt: It is not bad. It is going to be a great deal of work for you, for the rest of your life.
? stat:trust.brandt>=1 | Brandt: Come by my office at four. There is something I would like you to see that is not on any syllabus.
? stat:trust.brandt>=1 | ! next ch2_office
! next ch2_corridor

=== scene ch2_office
@chapter ch2
@place brandt_office
@location Brandt's office · 16:00
! flag brandt_office
~ Books stacked by colour, not subject. A window that doesn't close all the way. On the sill, a {chipped mug with a small logo, the lettering half worn off|c_mug}.
Brandt: Sit. Tea?
Elias: No, thank you.
~ Brandt takes a folder from a drawer and slides a sheet across: a thermal-paper printout, faded to the colour of weak tea. A logic-analyzer capture, annotated by hand.
Brandt: My own final. A long time ago. Look at channel six.
Elias: A pin that shouldn't be doing anything, doing something.
Brandt: My professor put it there. I found it by accident. He told me it was the most important thing I did that year, and I did not understand him for a decade.
~ On the shelf behind him, a {framed photograph of a lab group|c_photo}: a younger Brandt, and beside him a young woman with her reading glasses pushed up into dark hair, laughing at whoever holds the camera.
Elias: Why show me?
Brandt: Because somebody should have told me sooner what it would cost.
~ He doesn't explain. He turns the mug on the sill a quarter turn, so the logo faces the window.
Brandt: Mind the signal under the noise, Mr. Voss.
! next ch2_corridor

=== scene ch2_corridor
@chapter ch2
@place corridor
@location Third-floor corridor
~ The man in the pressed shirt is waiting by the vending machine. He is not buying anything.
Werner: Mr. Voss. Werner Albrecht. %FIRM%.
~ He holds out a card. Plain white, no job title, and in one corner {a square wave folded into the letter A|c_logo_card}.
Elias: You were at the back of the exam.
Werner: I was.
Elias: Why?
Werner: To see who would finish early.
~ That is true, and it is not the answer. Elias can hear the difference. He isn't sure yet what it is made of.
Werner: We have a position. Embedded, bench work to begin with. The offer is in the envelope. You will want to know how we found you: {your applications. We keep them on file.|c_applications}
~ Elias sent eleven applications in March. He doesn't remember one to %FIRMSHORT%. He doesn't remember eight of them, either.
Werner: Read the offer. Do not call the number before Friday.
Elias: Why not before Friday?
Werner: Because you would call tonight, and you would be deciding on adrenaline.
+ "What would I be building?" => ch2_ask_what
+ "Did Professor Brandt tell you about me?" => ch2_ask_brandt
* "Friday, then." => ch2_friday
Werner: The third of July. A Monday. Nine. Sharp.
~ He leaves the way he sat in the exam hall: without hurry, and without looking back.
~ Elias opens his notebook to a clean page and writes a question. Under it, three answers, none of which he likes.
! open H_A
! open H_B
! open H_C
! next ch2_end

=== scene ch2_ask_what
@kind call
Elias: What would I be building?
Werner: That's not something I can tell you.
Elias: Not yet, or not ever?
Werner: That's also not something I can tell you.

=== scene ch2_ask_brandt
@kind call
Elias: Did Professor Brandt tell you about me?
~ Werner {turns a plain ring on his right hand. Once.|c_ring1}
Werner: That's not something I can tell you.
! flag werner_ring

=== scene ch2_friday
@kind call
Elias: Friday, then.
Werner: Friday.

=== scene ch2_end
@chapter ch2
@place student_flat
@location Student flat · Friday, 09:00
~ Friday. He waited, because he was told to, and because the man was right: on Thursday night he would have called.
~ The envelope holds a contract, a relocation allowance, and a street address in a city he has never been to.
Elias: (on the phone) Voss. Yes. Yes — Monday the third. I know. Nine. Sharp.
~ He hangs up, checks that the stove is off, and starts packing.
! endchapter ch2
! next ch3_move

# ─────────────────────────── ch2 clues ───────────────────────────

=== clue c_partner
@chapter ch2
@volume murmur
@track situational
@tags exam
@supports H_C
@observation "An industry partner." No name, in a notice that names everything else.
@ask Ask Brandt who the partner is => ask_partner

=== scene ask_partner
@kind call
@location Lab 2.14 · after class
Elias: The exam notice says the boards come from an industry partner. Who?
Brandt: People who make things, Mr. Voss, and who occasionally lend them.
~ It is the second time he has used exactly that phrase.
! stat susp.brandt +1

=== clue c_riddle_nc
@chapter ch2
@volume murmur
@track situational
@tags exam brandt
@supports H_B
@observation His riddles usually point at next week's sheet. There is no next week's sheet. There is the exam.
@ask Ask what it's for => ask_riddle_nc

=== scene ask_riddle_nc
@kind call
Elias: What's this one for? There's no sheet next week.
Brandt: Everything this week is for the exam, Mr. Voss. That is what makes it an exam.
! stat trust.brandt +1

=== clue c_felix_trick
@chapter ch2
@volume loud
@track situational
@tags exam
@supports H_B
@observation A trick every year, according to Felix and a forum thread. A tradition.

=== clue c_j4_exam
@chapter ch2
@volume whisper
@track technical
@tags pattern
@supports H_C H_E
@observation A ten-pin keyed header, marked J4. The lab boards don't have one.

=== clue c_man_exam
@chapter ch2
@volume murmur
@track situational
@tags werner
@supports H_C
@observation Pressed shirt. Not proctoring, not grading. His eyes are on the benches, not the students.

=== clue c_nc_pin
@chapter ch2
@volume murmur
@track technical
@tags pattern
@supports H_C H_E
@observation PA7 is marked NC. It isn't quiet: two short pulses, a long gap. Over and over.
@ask Measure it => ask_nc_pin

=== scene ask_nc_pin
@kind call
@location Exam Hall B · Bench 22
~ Cursors on the capture. Then a longer capture, because the first one isn't enough.
~ High for 80 milliseconds. Low for 120. High for 80. Low for 720. One frame, one second, dead on.
~ Except every seventeenth frame. There, the long gap is 700 milliseconds instead of 720.
Elias: (under his breath) Hm. Noted.
! flag measured_hb

=== clue c_u7
@chapter ch2
@volume whisper
@track technical
@tags pattern
@supports H_C H_E
@observation The parts list says U7 is do-not-populate. The footprint on this board has a chip in it.

=== clue c_man_leaves
@chapter ch2
@volume murmur
@track situational
@tags werner
@supports H_C
@observation He left the moment Brandt read the last line. Not before. Not after.

=== clue c_mug
@chapter ch2
@volume whisper
@track situational
@tags brandt
@supports H_C
@observation A square wave folded into the letter A. Under it, worn lettering: ARN—
@ask Ask about the mug => ask_mug

=== scene ask_mug
@kind call
Elias: The mug. Where's it from?
Brandt: A gift. From people who make things.
~ The third time. He hears it too, this time; Elias watches him hear it.
! stat susp.brandt +1
! flag asked_mug

=== clue c_photo
@chapter ch2
@volume whisper
@track situational
@tags brandt
@supports H_C
@observation A lab group, twenty-odd years ago. Beside young Brandt, a woman with reading glasses pushed up into dark hair.
@ask Ask who she is => ask_photo

=== scene ask_photo
@kind call
Elias: Who's that? Next to you.
Brandt: A former student. A better engineer than I ever was. She went into industry.
~ He says "industry" the way other people say "abroad."
! stat trust.brandt +1

=== clue c_logo_card
@chapter ch2
@volume murmur
@track situational
@supports H_C
@observation A square wave folded into the letter A. No name, no title.
@observation_if seen:c_mug | The same mark as the mug on Brandt's windowsill.

=== clue c_applications
@chapter ch2
@volume loud
@track situational
@supports H_A
@observation He answered the question before I asked it.

=== clue c_ring1
@chapter ch2
@volume murmur
@track situational
@tags werner
@supports H_C
@weakens H_A
@observation I said Brandt's name. He turned the ring on his right hand, once.

# ─────────────────────────── ch2 tasks ───────────────────────────

=== task 2.1
@chapter ch2
@form lab
@title Borrowed Pins
@code Lab sheet 5
@board Lab Board L1 · %MCU% · 100 MHz
@device dev_l1
@brief Take PB2 back for GPIO; leave PB6 with the clock-output block and make it produce 100 kHz.
@schematic
PA0 ◀── BUTTON  (active high)
PB2 ──▶ LED     (power-on mux: TIMER0 capture)
PB6 ──▶ TP1     (power-on mux: CLKOUT)
@end
@rules
PB2 follows PA0 within 10 µs.
PB6 carries 100 kHz ± 0.1 %, 50 % duty.
@end
@provided startup.S · link.ld · datasheet · your gpio driver
@driver pinmux_set — choose a pin's function
@hint1 Felix: PB2 won't do anything, and PB6 is doing something I never told it to. Is that normal?
@hint2 Brandt: At power-on both pins belong to other blocks. One you must take back. The other you must leave with its owner, and configure the owner.
@hint3 Brandt: (on the whiteboard) GPIOB.MUX bit 2 = 0 for the LED. Leave MUX bit 6 at 1: CLKOUT has been running since reset, at 2 kHz. Write 1000 to SYSCTL.CLKOUTDIV.
@after ch2_t1_after

=== task 2.2
@chapter ch2
@form lab
@title Roll Call
@code Lab sheet 6
@board Lab Board L1 · %MCU% · 100 MHz
@device dev_l1
@brief Keep the LED on the button inside 2 µs while counting every pulse on PA1. No interrupts.
@schematic
PA0 ◀── BUTTON
PA1 ◀── PULSE_IN     (pulses ≥ 3 µs, gaps ≥ 3 µs)
PB2 ──▶ LED
PB8..PB11 ──▶ COUNT[3:0]
@end
@rules
PB2 equals PA0 within 2 µs.
COUNT equals the number of PA1 pulses so far, mod 16, within 10 µs of each pulse.
No interrupts.
@end
@provided startup.S · link.ld · datasheet · your drivers
@driver poll loop — one pass, every input, no waiting
@hint1 Felix: My count is always a bit low. Like it's missing the short ones.
@hint2 Brandt: A three-microsecond pulse is three hundred cycles. How long is one pass through your loop? Measure it between two breakpoints.
@hint3 Brandt: (on the whiteboard) Read GPIOA.DAT once per pass. Detect PA1 rising edges against the previous sample and handle PA0 in the same pass. No calls, no divisions, no printing inside the loop.
@after ch2_t2_after

=== task 2.3
@chapter ch2
@form exam
@title Final Exam — Pedestrian Crossing
@code EE-412 · Practical examination
@board Exam board · rev A · %MCU% · 100 MHz
@device dev_exam
@brief Cars get green by default. A walk request runs amber, then red with WALK, then red-amber, then green again. The exam board runs every timing at one tenth of real time.
@schematic
PA0 ◀── WALK_REQ   (button, active high)
PB0 ──▶ CAR_RED
PB1 ──▶ CAR_AMBER
PB2 ──▶ CAR_GREEN
PB3 ──▶ WALK
PA7 ─── J4.7       NC
U7  ─── DNP        (do not populate)
@end
@rules
Amber 300 ms → red + WALK 500 ms → red-amber 100 ms → green, each ± 1 %.
Green lasts at least 800 ms before a request is served, from power-on too.
A request during green is remembered, not ignored.
@end
@capture Bench capture · a request 100 ms after power-on
span 0 2000
ch WALK_REQ | 0:0 100:1 115:0
ch CAR_GREEN | 0:1 800:0 1700:1
ch CAR_AMBER | 0:0 800:1 1100:0 1600:1 1700:0
ch CAR_RED | 0:0 1100:1 1700:0
ch WALK | 0:0 1100:1 1600:0
ch J4.7 (NC) | hb 0 2000 | c_nc_pin
@end
@provided startup.S · link.ld · the datasheet · a pencil. Your library stays in your bag.
@hint1 Felix: (three benches over, mouthing it silently) state machine?
@hint2 Brandt: (to the room) Write down the states before you write down any code.
@hint3 Brandt: (to the room) Clarification for every bench: a walk request during green must be remembered, and served once green has lasted 800 milliseconds.
@after ch2_t3_after
@parts U7 is listed as {DNP — do not populate|c_u7}.
