# ─────────────────────────── ch4 clues ───────────────────────────

=== clue c_tamper
@chapter ch4
@volume murmur
@track technical
@tags odd
@weakens H_D
@payoff future
@observation The silkscreen and the ticket disagree about what the input is.

=== clue c_printer
@chapter ch4
@volume murmur
@track situational
@tags aaron project
@supports H_I
@opens H_H H_I
@observation 7731-04 — the number between my -03 and -05. Assigned to A. Steiner. Every one of my work orders is approved by W. Albrecht. This approval line is blank.

=== clue c_aaron_call
@chapter ch4
@volume whisper
@track situational
@tags aaron
@observation The stairwell has the worst reception in the building. People go there to not be heard.
@ask Walk past the stairwell => ask_aaron_call

=== scene ask_aaron_call
@kind call
~ He doesn't mean to listen. The stairwell carries sound the way it carries cold.
Aaron: (low) —I said Friday. I said I'd have it done. No. No, don't call her. It's fine. It's—
~ Aaron sees him on the landing. He hangs up.
Aaron: Hey. It's fine.
! stat susp.aaron +1

=== clue c_free_run
@chapter ch4
@volume murmur
@track technical
@tags odd
@weakens H_D
@payoff future
@observation The timer must keep running while someone has the processor frozen to inspect it.

=== clue c_done_before
@chapter ch4
@volume murmur
@track situational
@tags werner bench6
@supports H_F
@observation "He's done it before." Past tense. Specific.

=== clue c_socks
@chapter ch4
@volume whisper
@track situational
@decoy
@observation One grey, one navy. He has never once noticed.

=== clue c_fridge_photo
@chapter ch4
@volume whisper
@track situational
@tags bench6
@supports H_F
@weakens H_G
@observation Summer, the bench floor, eight people. Bench 6 is occupied. Whoever sits there has turned away from the camera, mid-laugh.
@ask Ask who's at Bench 6 => ask_fridge_photo

=== scene ask_fridge_photo
@kind call
Elias: Who's at Bench 6? In the photo.
~ Jonas stops stirring.
Jonas: Someone who isn't here any more. Not my story, Elias. Ask Werner.
~ A beat.
Jonas: No. Don't ask Werner.
! flag asked_bench6

=== clue c_jonas_area2
@chapter ch4
@volume whisper
@track technical
@tags pattern
@supports H_E
@observation Area 2's boards. The same ten-pin header.
@ask Ask about the boards => ask_jonas_area2

=== scene ask_jonas_area2
@kind call
Elias: The Area 2 boards. What did they do?
Jonas: No idea. Bring-up only — power, clocks, does it boot. It booted. There was a little status LED doing a double blink, like yours.
~ He shrugs and reaches for the parmesan.
! device dev_area2

=== clue c_not_werner
@chapter ch4
@volume murmur
@track situational
@tags aaron
@supports H_I
@opens H_H H_I
@payoff future
@observation Every job in this building comes on a ticket from Werner. Aaron's evening work doesn't.

=== clue c_werner_bench
@chapter ch4
@volume whisper
@track situational
@tags werner bench6
@supports H_F
@observation He looks at everything. He walked past Bench 6 as if it weren't there.

=== clue c_brandt_worries
@chapter ch4
@volume murmur
@track situational
@tags brandt
@supports H_B
@observation He said he told them. He didn't say who asked.

=== clue c_banner
@chapter ch4
@volume whisper
@track situational
@decoy
@observation "EXCELLENCE" is noticeably smaller than "DIETER."

=== clue c_lea_advance
@chapter ch4
@volume murmur
@track situational
@tags aaron
@observation Salary advances. The firm doesn't do them. Lea checked twice.

=== clue c_sina_report
@chapter ch4
@volume whisper
@track situational
@tags sina pattern
@supports H_E
@observation Her name on the cover. A red stamp: SHELVED. The title: "Supervisory heartbeat for distributed field units."
@ask Ask about it => ask_sina_report

=== scene ask_sina_report
@kind call
Elias: The proposal. The stamp says shelved.
Sina: It says that, yes.
~ She takes it down and looks at the cover as if checking it's still true.
Sina: Rev three. They shelved it. Then someone asked for a copy. Then nobody would tell me who.
! stat trust.sina +1
! flag sina_proposal

=== clue c_ovr_fault
@chapter ch4
@volume murmur
@track technical
@tags odd
@payoff future
@observation Whatever drives OVR outranks the firmware — even firmware that has hung.

=== clue c_hb_in
@chapter ch4
@volume loud
@track technical
@tags pattern
@supports H_E
@observation J4.7. The pin marked NC on every board. Here, it has a name.

=== clue c_watchdog
@chapter ch4
@volume murmur
@track situational
@tags brandt
@payoff future
@observation Nobody has mentioned watchdogs to him. Not yet.

=== clue c_tap_cafe
@chapter ch4
@volume whisper
@track situational
@tags self
@observation Two quick taps and a long rest. Mira glances at his hand, and then pointedly doesn't.

=== clue c_rigs_noticket
@chapter ch4
@volume murmur
@track situational
@tags aaron sina
@supports H_I
@opens H_H H_I
@observation Sina tracks every ticket on the floor. Aaron's new rigs don't have one.

=== clue c_glasses
@chapter ch4
@volume whisper
@track situational
@tags brandt
@supports H_C
@observation Reading glasses, pushed up into her hair until she needs them.
@observation_if seen:c_photo | Reading glasses, pushed up into her hair until she needs them. The woman in Brandt's photograph wore hers exactly the same way.

=== clue c_strap
@chapter ch4
@volume whisper
@track situational
@tags bench6
@supports H_F
@weakens H_G
@observation Someone logged the engraving and not the initials. That takes a decision.

=== clue c_costcentre
@chapter ch3
@volume whisper
@track situational
@tags project
@supports H_E
@observation Cost centre 7731.
@observation_if solved:3.1 | Cost centre 7731. Every work order I've had is numbered 7731-something. I was on it before I arrived.

# ─────────────────────────── ch4 tasks ───────────────────────────

=== task 4.1
@chapter ch4
@form workorder
@title WICKET
@code WO 7731-07
@rev 2
@board BRD-2260 rev A · %MCU% · 100 MHz
@device dev_2260
@behavior
When DOOR goes low, LAMP goes high within 5 µs. LAMP clears after DOOR has been high for 100 ms (± 1 ms).
The main loop computes the CRC-32 (IEEE 802.3, as in zip) of flash 0x0000–0x0FFF over and over, and writes it to DBGCON.PUTW every 100 ms. It may not block.
@end
@schematic
PA0 ◀── DOOR     (silkscreen: TAMPER)
PB0 ──▶ LAMP
J4.7             NC
@end
@provided link.ld · datasheet · your library · startup.S (vector table stub)
@driver irq_attach / irq_enable — a handler, a vector, a flag to clear
@hint1 Jonas: Does your handler run at all? Put a breakpoint in it. Humour me.
@hint2 Jonas: Three switches have to be on for an interrupt to land: the source, the PIE, and the CPU's own enable. Plus the vector.
@hint3 Werner: Amendment to WO 7731-07. GPIOA.INTFALL and INTEN bit 0 for PA0. PIE.IER bit 1 (GPIOA is vector 1) and PIE.CTRL.EN. __vectors[1] = your handler. Set mstatus.MIE. In the handler, write 1 to INTFLG bit 0 before returning.
@after ch4_wo1_after

=== task 4.2
@chapter ch4
@form workorder
@title VIGIL
@code WO 7731-08
@rev 1
@board BRD-2260 rev A · %MCU% · 100 MHz
@device dev_2260
@behavior
A 1 kHz tick interrupt from CPUTIMER0. The handler completes in under 2 µs.
TICK_OUT toggles every 500 ticks: 500 ms ± 0.1 %.
The timer must not stop on debug halt.
@end
@schematic
PB1 ──▶ TICK_OUT
J4.7            NC
@end
@provided link.ld · datasheet · your library · startup.S (vector table stub)
@driver tick_init / ticks — a system tick that survives being watched
@hint1 Jonas: Your handler's running… constantly? Back to back, forever? What's telling it to stop?
@hint2 Jonas: The flag is write-one-to-clear. Writing zero does nothing. Reading it does nothing.
@hint3 Werner: Amendment to WO 7731-08. PRD = 99999 for 1 kHz; TCR.TIE on, TSS off. Write 1 to CPUTIMER0.TIF inside the handler. Set TCR.FREE = 1 so the tick survives a debug halt.
@after ch4_wo2_after

=== task 4.3
@chapter ch4
@form workorder
@title SEXTANT
@code WO 7731-09
@rev 3
@board BRD-2275 rev B · %MCU% · 100 MHz
@device dev_2275
@behavior
The SCI receiver is flooded at 1 Mbaud, 8N1. Every byte goes into a ring buffer; none are lost.
The main loop writes the CRC-32 of every 64-byte block to DBGCON.PUTW, in order.
SAFE follows OVR (active low) within 3 µs — during the flood, and even if the application has hung.
@end
@schematic
PA5 ◀── OVR      (active low)
PB3 ──▶ SAFE
PA8 ◀── J3.1     (SCI RXD, 1 Mbaud 8N1; its power-on function)
J4.7             NC
@end
@provided link.ld · datasheet · your library · startup.S (vector table stub)
@driver ring_put / ring_get / irq_priority — a buffer, and an order of importance
@hint1 Jonas: OVR's late when the serial stuff floods, right? So who's hogging the CPU?
@hint2 Jonas: Your receive handler can be preemptible, or it can be short. Ideally both.
@hint3 Werner: Amendment to WO 7731-09. OVR (PA5: GPIOA, vector 1) at PIE priority 0, SCI RX (vector 5) at priority 3. The RX handler only moves bytes from RXDATA into the buffer. For margin, set mstatus.MIE at its start so OVR can preempt it.
@after ch4_recall

=== task 4.4
@chapter ch4
@form workorder
@title HEARTH
@code WO 7731-10
@rev 1
@board BRD-2290 rev A · %MCU% · 100 MHz
@device dev_2290
@behavior
No startup file. Write the boot header, the reset path and the vector table yourself.
Supervise HB_IN. A frame is two 80 ms pulses 120 ms apart, then a long gap; one frame per second.
ALARM goes high if two consecutive frames are missing or malformed, and clears after three good frames. One bad frame alone is not an alarm.
@end
@schematic
PA7 ◀── J4.7   HB_IN
PB0 ──▶ ALARM
PB7 ──▶ DBG    (spare)
@end
@capture Reference: HB_IN with two dropped frames
span 0 6000
ch HB_IN | hb 0 2000 | c_hb_in
ch ALARM | 0:0 4380:1
@end
@extra flag:measured_hb | Your own check, from your exam notes: some frames have a 700 ms long gap instead of 720. Don't alarm on them. Pulse DBG once for each one.
@provided link.ld · datasheet · your library — and nothing else
@driver reset path + vector table — the first code that ever runs
@hint1 Jonas: Does it even reach main? Single-step from the reset vector. Seriously.
@hint2 Jonas: Flash word 0 is the stack pointer, word 1 is where the core starts. Then the reset path: copy .data, zero .bss, main. And the vector table has to be aligned the way the PIE wants it.
@hint3 Werner: Amendment to WO 7731-10. Section .boot holds { _stack_top, reset_handler }. In reset_handler: copy .data, zero .bss, point PIE.VBASE at a 256-byte-aligned table, call main. Timestamp every HB_IN edge; a frame is good once its two pulses are followed by 600 ms of quiet. ALARM after 2.5 s without a good frame; clear after three good frames in a row.
@after ch4_wo4_after
