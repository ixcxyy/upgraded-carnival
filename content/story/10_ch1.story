# ═══════════════════════════ CHAPTER 1 · Lab 2.14 ═══════════════════════════
# Phase: University. Tech: GPIO — direction, set/clear/toggle, reading inputs.
# Tutorial chapter: few hotspots, two of them harmless decoys.

=== scene ch1_open
@chapter ch1
@place lab214
@location Lab 2.14 · Engineering, third floor
! chapter ch1
~ Twelve benches. Twelve lab boards. A whiteboard nobody has fully erased since {spring|c_whiteboard}.
~ The board on Bench 4 is the size of a playing card: one chip, two pin headers, one button, one LED.
Felix: Morning. Did you do the reading?
Elias: Which part?
Felix: Any part.
Brandt: Good morning. This semester you will not use a library. You will not use a framework. You will use addresses.
Felix: He says that every year.
Brandt: Every peripheral on that chip lives at a number. Write to the right number and the world changes. Write to the wrong one and nothing happens — which, I promise you, is the more educational outcome.
~ Elias is already in the datasheet. Not the first page. The reset-value table, three pages from the back.
Felix: You're not even going to look at the schematic?
Elias: The schematic says what the board is supposed to do. The reset table says what it's going to do.
Brandt: Start with the button and the light.
! task 1.1

=== scene ch1_t1_after
@chapter ch1
@place lab214
@location Lab 2.14
~ Brandt stops behind Bench 4 and reads the waveform over Elias's shoulder for long enough that Felix stops typing.
Brandt: The requirement was ten microseconds. You are comfortably inside it.
Elias: The requirement was generous.
Felix: How did you get it working so fast? Mine does nothing.
Elias: Trivial. Every block on this chip powers up with its clock gated off, every pin powers up as an input, and half of them power up belonging to some other peripheral. So before the LED can light, you owe three writes — the clock, the mux, the direction — and none of them are in the lab sheet, because the lab sheet assumes you read page four.
Felix: Nobody reads page four, Elias.
Brandt: Mr. Adamek is right about the world and wrong about this bench.
Brandt: Four switches. Four lights. I would like the lights to disagree with the switches — all four, at once. If I see one light change before its neighbours, I will assume you don't respect them.
! task 1.2

=== scene ch1_t2_after
@chapter ch1
@place lab214
@location Lab 2.14
Felix: Mine flickers.
Elias: You're writing the pins one at a time.
Felix: Is that bad?
Elias: For a moment your LEDs are telling the truth about three switches and lying about the fourth.
Felix: That is so much worse when you say it like that.
~ At the front, Brandt caps a marker and writes a line on the whiteboard, under the old derivation. He does this at the end of every lab.
Brandt: For next week. {A pin that reads high with nothing attached is not lying to you. What is it telling you?|c_riddle1}
Brandt: Mind the {signal under the noise|c_signoff}.
! next ch1_home

=== scene ch1_home
@chapter ch1
@place student_flat
@location Student flat · shared kitchen, 23:10
~ The kettle works. Elias turns the stove knob to off. Checks it. Checks it again. It was off the first time. It's always off the first time.
~ His fingers tap on the counter while he waits: the lab board's reset values, in binary, low bit first. He doesn't notice he's doing it.
Felix [text]: did u do the pull-up thing yet
Elias [text]: That's next week's sheet.
Felix [text]: brandt basically put the answer on the whiteboard
Elias [text]: He put the question on the whiteboard. The answer is on page nine.
Felix [text]: of course it is
! next ch1_t3_req

=== scene ch1_t3_req
@chapter ch1
@place lab214
@location Lab 2.14 · the following week
Brandt: One button. One light. Press once, the light comes on. Press again, it goes off. Hold the button as long as you like; the light must not care.
Felix: That's just the first one again.
Elias: It isn't. The first one was a level. This is an edge.
Felix: Say that again, but like I'm tired.
Elias: Last time the light copied the button. This time the light has to remember.
! task 1.3

=== scene ch1_t3_after
@chapter ch1
@place lab214
@location Lab 2.14
Brandt: Mr. Voss. Last week's riddle.
Elias: A floating input reads whatever the room is doing. Your hand, the lights, the pin next to it. It isn't lying. It's reporting on its neighbours, because nobody told it what "nothing" means.
Brandt: And how does one tell it?
Elias: A resistor. Or the internal pull-up — which lives in a register that ignores you until you unlock it.
Brandt: Which is today's sheet. Thank you for spoiling it for everyone.
~ He doesn't sound annoyed. He sounds like someone who has ticked a box.
Brandt: A second button, on PA4. No resistor on the board. Active low. And the configuration register is protected, so be polite to it.
! task 1.4

=== scene ch1_t4_after
@chapter ch1
@place lab214
@location Lab 2.14 · after class
~ The room empties the usual way: loudly, then all at once.
Brandt: Mr. Voss. A moment.
~ Brandt is holding Elias's lab report from the protected-register sheet. There is a note in the margin in Elias's handwriting: the first read after enabling the pull-up comes back low; it settles in about two microseconds.
Brandt: You measured this.
Elias: It was there.
Brandt: It is documented nowhere. I checked, after I read your note. It took me most of an evening.
Elias: Sorry.
Brandt: Don't be. Most people never look at a thing they weren't asked about.
* "Is that what the exercises are for? Seeing who looks?" => ch1_ask_point
* Say nothing. => ch1_quiet
~ He hands the report back. There is a small red tick next to the note.
! endchapter ch1
! next ch2_open

=== scene ch1_ask_point
@kind call
Elias: Is that what the exercises are for? Seeing who looks?
Brandt: The exercises are for the exercises. What you do in the margins is your own business.
~ A pause, as if he has decided something.
Brandt: And, occasionally, mine.
! stat trust.brandt +1

=== scene ch1_quiet
@kind call
~ Elias says nothing. Brandt seems to find that an acceptable answer.
Brandt: Next week: the pins you think you own.

# ─────────────────────────── ch1 clues ───────────────────────────

=== clue c_whiteboard
@chapter ch1
@volume whisper
@track technical
@decoy
@observation An RC time-constant derivation, half erased. Someone's old lecture. Nothing to do with anything.

=== clue c_riddle1
@chapter ch1
@volume loud
@track technical
@decoy
@observation A floating input. That's next week's sheet.

=== clue c_signoff
@chapter ch1
@volume whisper
@track situational
@tags brandt
@payoff future
@observation He has closed every lab with it since first year. Nobody has ever asked what it means.
@ask Ask what it means => ask_signoff

=== scene ask_signoff
@kind call
Elias: What does it mean? "The signal under the noise."
Brandt: It means precisely what it says, Mr. Voss.
~ He picks up his bag, and stops at the door.
Brandt: On bad days, slightly more.
! stat trust.brandt +1

# ─────────────────────────── ch1 tasks ───────────────────────────

=== task 1.1
@chapter ch1
@form lab
@title Follow the Button
@code Lab sheet 1
@board Lab Board L1 · %MCU% · 100 MHz
@device dev_l1
@brief The LED on PB0 must follow the button on PA0 with less than 10 µs latency.
@schematic
PA0 ◀── BUTTON  (active high, external pulldown)
PB0 ──▶ LED     (active high)
@end
@rules
PB0 equals PA0 at all times, within 10 µs (1,000 cycles).
No output pulse shorter than 1 µs.
Hidden seeds randomise press times and lengths.
@end
@provided startup.S · link.ld · datasheet
@driver gpio_read / gpio_write — read a pin, drive a pin
@hint1 Felix: Wait — does the port have to be switched on or something? Mine does literally nothing.
@hint2 Brandt: Three things stand between a pin and the world, Mr. Voss: whether its block is clocked, what it is muxed to, and which way it faces. In that order.
@hint3 Brandt: (on the whiteboard, for everyone) PCLKCR bits 0 and 1 clock GPIOA and GPIOB. MUX bit 0 = 0 selects GPIO. DIR bit 0 = 1 makes PB0 an output. Then read DAT and write SET or CLEAR.
@after ch1_t1_after

=== task 1.2
@chapter ch1
@form lab
@title Contrarian
@code Lab sheet 2
@board Lab Board L1 · %MCU% · 100 MHz
@device dev_l1
@brief Four LEDs show the inverse of four switches. All four change together.
@schematic
PA0..PA3 ◀── SW0..SW3    (slide switches, external pulldowns)
PB0..PB3 ──▶ LED0..LED3  (active high)
@end
@rules
LEDn equals NOT SWn, within 10 µs.
When several LEDs change, they change within 200 ns of each other.
@end
@provided startup.S · link.ld · datasheet · your gpio driver
@driver gpio_write_mask — drive several pins in one store
@hint1 Felix: Is it cheating to read all the switches at once? Like, the whole port?
@hint2 Brandt: If your lights change one at a time, you are writing one at a time. How many stores does it take to set some bits and clear others?
@hint3 Brandt: (on the whiteboard) Read GPIOA.DAT once, mask with 0xF, invert. Then SET the ones and CLEAR the zeros in two back-to-back stores — the checker allows 200 ns between them.
@after ch1_t2_after

=== task 1.3
@chapter ch1
@form lab
@title Toggle
@code Lab sheet 3
@board Lab Board L1 · %MCU% · 100 MHz
@device dev_l1
@brief Each press of the button toggles the LED. Holding the button changes nothing.
@schematic
PA0 ◀── BUTTON  (active high, external pulldown, clean edges)
PB0 ──▶ LED     (active high)
@end
@rules
LED toggles within 10 µs of each rising edge on PA0.
The LED starts off.
LED does not change on falling edges or while the button is held.
Hidden seeds: 6–14 presses, random lengths.
@end
@provided startup.S · link.ld · datasheet · your gpio driver
@driver gpio_toggle — flip a pin through the TOGGLE register
@hint1 Felix: Mine toggles like a hundred times while I hold it. Is the stimulus being mean?
@hint2 Brandt: Your light is responding to a level. I asked it to respond to a change. What would you need to remember between two reads?
@hint3 Brandt: (on the whiteboard) Keep the previous sample in a variable. When previous is 0 and current is 1, write bit 0 to GPIOB.TOGGLE. Then previous = current.
@after ch1_t3_after

=== task 1.4
@chapter ch1
@form lab
@title Locked Door
@code Lab sheet 4
@board Lab Board L1 · %MCU% · 100 MHz
@device dev_l1
@brief A second button on PA4 has no resistor and is active low. Make it light LED1 while pressed.
@schematic
PA4 ◀── BUTTON2  (active LOW, no external resistor)
PB1 ──▶ LED1     (active high)
@end
@rules
LED1 is high while BUTTON2 is pressed, within 10 µs.
PA4 must not float: the internal pull-up must be enabled.
SYSCTL.PROTECT is locked again afterwards.
@end
@datasheet
GPIOx.PUE — internal pull-up enable, one bit per pin. PROTECTED: writes are ignored unless SYSCTL.PROTECT has been unlocked with its key. Lock it again afterwards.
@end
@provided startup.S · link.ld · datasheet · your gpio driver
@driver gpio_pullup — enable a pull-up through the protected register
@hint1 Felix: PA4 reads random stuff. Genuinely random. Is my board broken?
@hint2 Brandt: The pin is floating, and the register that would stop it floating ignores you until you ask politely. Where in SYSCTL does one ask politely?
@hint3 Brandt: (on the whiteboard) Write the unlock key to SYSCTL.PROTECT, set bit 4 in GPIOA.PUE, write the lock key back. Pressed reads 0.
@after ch1_t4_after
