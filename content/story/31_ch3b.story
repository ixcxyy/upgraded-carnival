# ═══════════════════════════ CHAPTER 3 · First Jobs (part 2) ═══════════════════════════

=== scene ch3_wo2
@chapter ch3
@place werner_office
@location Werner's office · Thursday, 09:00
Werner: CINDER passed. Satisfactory.
Werner: Next.
~ Codename TALLY. A push button, a counter, eight output lines. Bounce times on the button that would embarrass a doorbell.
Elias: There's no reset input.
Werner: Correct.
Elias: The count only goes up.
Werner: Correct.
Elias: {What do you count, that you never want to un-count?|c_tally_reset}
Werner: That's not something I can tell you.
! task 3.2

=== scene ch3_wo2_after
@chapter ch3
@place benchfloor
@location Bench floor · Friday, 18:10
Jonas: It's Friday. You survived a week. Tradition says Bar Linde.
Lea: Tradition says Bar Linde! I'm coming. Sina's coming. Sina, you're coming.
Sina: Sina has a regression to finish.
Lea: Sina's coming at eight. Aaron?
Aaron: Not tonight. It's fine. Go.
~ {Aaron's jacket is on the back of his chair. It was on the back of his chair on Monday, too.|c_jacket}
* Go to Bar Linde. -> ch3_bar
* Go home. -> ch3_home1

=== scene ch3_bar
@chapter ch3
@place bar
@location Bar Linde · Friday, 20:15
! flag went_bar
~ Low ceiling, dark wood, a jukebox nobody controls. Jonas has claimed the corner table the way other people claim parking spaces.
Lea: Okay. First-week questions. You get one. Anything. I know everything.
Elias: What's 7731? Every work order I get starts with it.
Lea: Oh, {that's the small-jobs bucket. Everything on this floor is 7731.|c_bucket} Next question. Better question.
Elias: How long has Werner been here?
Lea: Oof, straight in. Eighteen years. Same week as Petra — nobody remembers that but me.
Lea: Don't tell anyone, but— {Werner went to some university thing in May|c_lea_may}. Werner. A university. He doesn't come to the Christmas party, and it's across the hall.
Jonas: Lea.
Lea: What? It's not a secret, it's a calendar.
~ Sina arrives at exactly eight, as announced, and orders sparkling water.
Sina: The regression passed.
Jonas: She says that like a toast.
Sina: Actually— it is one.
Lea: Sina did last year's big bring-up by herself, by the way. Three boards, two weeks, one {commendation she won't talk about|c_commendation}.
Sina: It was a team.
Lea: It was you and a soldering iron.
* "Which part was hardest?" => ch3_bar_sina
* Let it pass.
Lea: Elias, what's your thing? Everyone has a thing. Jonas remembers birthdays. Sina corrects people. I know things.
Jonas: Elias taps.
Elias: I don't tap.
~ {He is tapping. On the table.|c_tap_bar} Low bit first.
Jonas: He taps in binary. I checked. It was forty-two, twice.
Elias: That's a coincidence.
Jonas: That's a nerd.
! stat trust.jonas +1
! next ch3_home1

=== scene ch3_bar_sina
@kind call
Elias: Which part was hardest?
Sina: The clock tree. The reference design was wrong, and nobody believed it was wrong for nine days.
Elias: What convinced them?
Sina: A scope and a very long email.
~ It's the first time she has looked at him as if he were a person rather than a policy decision.
! stat trust.sina +1

=== scene ch3_home1
@chapter ch3
@place flat
@location The new flat · Friday, late
? flag:went_bar | ~ Home after eleven, which is late for him and early for Jonas.
~ An envelope on the mat. Cream paper, fountain pen, the university crest crossed out and his name written over it by hand. {Postmarked Tuesday, 07:10.|c_postmark}
! doc doc_letter1
Brandt [letter]: Dear Elias — I hope %CITY% is treating you better than its reputation suggests. I confess I have no idea what its reputation is. That seemed the polite assumption.
? flag:asked_mug | Brandt [letter]: You asked about my mug. I have since bought a plainer one. It is very ugly, and I recommend it.
Brandt [letter]: I will not ask about the work; I suspect you could not tell me. I will ask instead whether you are eating.
Brandt [letter]: A question for your first month: a heartbeat that never falters tells you only that it has not faltered yet. What does it tell you when it does?
Brandt [letter]: Mind the signal under the noise. — A.B.
~ He reads it twice. Then he checks the stove, which he hasn't used, and sits down to answer.
* Write back properly. => ch3_reply_long
* Write back two lines. => ch3_reply_short
! next ch3_wo3

=== scene ch3_reply_long
@kind call
~ He writes three pages. The radiator. Jonas and the pretzels. The café where the owner draws people's hands. The bench nobody had for fourteen months.
~ He doesn't write about the heartbeat. He isn't sure why not.
! stat trust.brandt +1

=== scene ch3_reply_short
@kind call
Elias [letter]: The city is fine. I am eating. — E.
~ Brandt will read the first sentence as polite and the second as a lie. Both readings are correct.

=== scene ch3_wo3
@chapter ch3
@place werner_office
@location Werner's office · the second Monday, 09:00
Werner: MARLOW. Period monitor. There's a capture from the client's rig attached.
Elias: Whose rig?
Werner: The client's.
~ He says it the way you close a drawer.
! task 3.3

=== scene ch3_wo3_after
@chapter ch3
@place benchfloor
@location Bench 6 · 16:45
Sina: Your monitor flags a fault at nine hundred ninety-five milliseconds.
Elias: The window is plus or minus half a percent.
Sina: Actually— nine ninety-five is the boundary. The ticket says "outside," so the boundary itself passes. You're failing a legal period.
~ She's right. He checks it twice, and she is right.
* "You're right. Thank you." => ch3_sina_right
* Fix it without a word. => ch3_sina_silent
~ That evening he turns the notebook to a new page. Three boards now. He writes a second question, and two answers.
! open H_D
! open H_E
! next ch3_wo4

=== scene ch3_sina_right
@kind call
Elias: You're right. Thank you.
Sina: The data was right. I just read it.
~ She goes back to Bench 1. She doesn't say "actually" again for the rest of the afternoon, which Jonas later informs him is a record.
! stat trust.sina +1

=== scene ch3_sina_silent
@kind call
~ He fixes it. Sina watches, waits for him to say something, and goes back to Bench 1 when he doesn't.
~ At her bench she re-solders a joint that was already perfect.

=== scene ch3_wo4
@chapter ch3
@place werner_office
@location Werner's office · the fourth Monday, 09:00
Werner: LINDEN. Last one this month.
~ ENABLE stays high only while ACK keeps toggling. Miss a quarter of a second and ENABLE drops, and stays dropped, until RESET_A and RESET_B are pressed together.
Elias: A dead man's switch.
Werner: An operator-presence monitor.
Elias: {Two reset buttons, on separate panels.|c_two_person}
Werner: Correct.
Elias: So one person can't restart it alone.
Werner: That is what "separate panels" means, yes.
~ Werner's ring stays still. It's the first time Elias has noticed it staying still, which means he has been watching it.
! task 3.4

=== scene ch3_wo4_after
@chapter ch3
@place werner_office
@location Werner's office · Friday, 17:00
Werner: Four work orders. Four passes. Satisfactory.
Elias: Is that good?
Werner: It's satisfactory. If it were good, I would have said good.
? flag:asked_lea_may | Werner: Lea tells me you're interested in my travel.
? flag:asked_lea_may | Elias: Lea tells everyone everything.
? flag:asked_lea_may | Werner: Yes. That's why I'm telling you that she told me.
Werner: Eat something this weekend. Brenner tells me you don't.
~ He turns back to his screen, which means the meeting is over. On the way out Elias notices the pen on the desk: same pen as on the first day, at the same angle to the pad.
! flag werner_eat
! endchapter ch3
! next ch4_open

# ─────────────────────────── ch3 clues, part 2 ───────────────────────────

=== clue c_tally_reset
@chapter ch3
@volume loud
@track technical
@tags odd
@weakens H_D
@payoff future
@observation No reset input. The count only ever goes up.

=== clue c_jacket
@chapter ch3
@volume whisper
@track situational
@tags aaron
@observation Same grey jacket, same chair, all week, whatever the weather.

=== clue c_bucket
@chapter ch3
@volume loud
@track situational
@tags project
@supports H_D
@observation The whole floor, one number. That's what Lea says.

=== clue c_lea_may
@chapter ch3
@volume murmur
@track situational
@tags werner
@supports H_C
@observation My exam was on the eleventh of May.
@ask Ask which university => ask_lea_may

=== scene ask_lea_may
@kind call
Elias: Which university?
Lea: Don't tell anyone, but— I booked his train. Yours, I think? Is that weird? That's weird. I'm going to stop talking.
~ She doesn't stop talking. She changes subject, which with Lea is the same distance travelled.
! stat susp.werner +1
! flag asked_lea_may

=== clue c_tap_bar
@chapter ch3
@volume whisper
@track situational
@tags self pattern
@observation Not forty-two. Two quick taps and a long rest, over and over. He doesn't know where he picked it up.

=== clue c_commendation
@chapter ch3
@volume murmur
@track situational
@tags sina
@observation Her jaw tightened on "commendation," not on "by herself."

=== clue c_postmark
@chapter ch3
@volume whisper
@track situational
@tags brandt
@supports H_C
@observation Posted Tuesday at 07:10. Werner handed me CINDER on Tuesday at 14:00. The letter asks about heartbeats.

=== clue c_capture_j47
@chapter ch3
@volume whisper
@track technical
@tags pattern
@supports H_E H_C
@observation Channel 3 is labelled J4.7 (NC). Two short pulses, a long gap, once a second.
@observation_if flag:measured_hb | Channel 3, J4.7 (NC): the pattern from the exam board, to the millisecond — including the short frame every seventeenth beat.
@ask Measure it => ask_capture_j47

=== scene ask_capture_j47
@kind call
@location Bench 6 · the MARLOW attachment
? flag:measured_hb | ~ He doesn't need cursors. He lays his exam numbers over it, and they fit to the millisecond, short frame and all.
? !flag:measured_hb | ~ Cursors on channel three. High 80, low 120, high 80, low 720. One frame, one second.
? !flag:measured_hb | ~ The ticket's attachment runs for forty seconds, not four. He scrolls. Every seventeenth frame, the long gap is 700 milliseconds instead of 720.
Elias: (under his breath) Hm. Noted.
! flag measured_hb

=== clue c_two_person
@chapter ch3
@volume murmur
@track technical
@tags odd
@weakens H_D
@payoff future
@observation A restart needs two people, at two panels, at least two metres apart.

# ─────────────────────────── ch3 tasks 3.2–3.4 ───────────────────────────

=== task 3.2
@chapter ch3
@form workorder
@title TALLY
@code WO 7731-03
@rev 1
@board BRD-2231 rev A · %MCU% · 100 MHz
@device dev_2231
@behavior
Count presses of OP_BTN. Show the count in binary on COUNT[7:0].
Exactly one count per press, within 50 ms of the contact settling. Contact bounce up to 20 ms.
COUNT starts at 0 and never decrements. There is no reset input.
@end
@schematic
PA0 ◀── OP_BTN       (active low, external pull-up, bounce ≤ 20 ms)
PB0..PB7 ──▶ COUNT[7:0]
J4.7                 NC
U7                   DNP
@end
@provided startup.S · link.ld · datasheet · your library
@driver debounce_update — accept a state only once it has held still
@hint1 Jonas: Your count goes up by three sometimes? That's the button bouncing, not the client lying.
@hint2 Jonas: Don't trust an edge until it has been stable for a while. How long is the worst bounce in the stimulus? Pick a window longer than that.
@hint3 Werner: Amendment to WO 7731-03. Sample OP_BTN every 1 ms from CPUTIMER0. Accept a new state after 25 equal samples. Count on each accepted press.
@after ch3_wo2_after

=== task 3.3
@chapter ch3
@form workorder
@title MARLOW
@code WO 7731-05
@rev 2
@board BRD-2240 rev B · %MCU% · 100 MHz
@device dev_2240
@behavior
Measure the period of REF_IN, rising edge to rising edge.
Assert FAULT within 10 ms of any period outside 1.000 s ± 0.5 %.
Clear FAULT after three consecutive good periods.
@end
@schematic
PA3 ◀── J4.3  REF_IN
PB5 ──▶ J2.2  FAULT
J4.7          NC
U7            DNP
@end
@capture Client rig capture, attached to the ticket
span 0 4000
ch REF_IN | 0:1 10:0 1000:1 1010:0 2000:1 2010:0 3000:1 3010:0
ch FAULT | 0:0
ch J4.7 (NC) | hb 0 4000 | c_capture_j47
@end
@provided startup.S · link.ld · datasheet · your library
@driver capture_period — latch the free-running counter on an edge
@hint1 Jonas: Are you timing it with the counter or with a loop? Because a loop is going to lie to you.
@hint2 Jonas: Latch the free-running counter on each rising edge and subtract. Watch what happens when it wraps.
@hint3 Werner: Amendment to WO 7731-05. On each REF_IN edge, period = (previous − now) mod 2^32; the counter counts down. FAULT if period < 99,500,000 or > 100,500,000 cycles.
@after ch3_wo3_after

=== task 3.4
@chapter ch3
@form workorder
@title LINDEN
@code WO 7731-06
@rev 1
@board BRD-2252 rev A · %MCU% · 100 MHz
@device dev_2252
@behavior
ENABLE is high from start-up, and stays high only while ACK toggles at least every 250 ms.
A missed deadline drops ENABLE within 1 ms, and it stays latched low.
Release only when RESET_A and RESET_B are both pressed in the same 1 ms sample; ENABLE rises within 2 ms.
@end
@schematic
PA0 ◀── ACK
PA1 ◀── RESET_A    (panel 1, active low)
PA2 ◀── RESET_B    (panel 2, active low)
PB0 ──▶ ENABLE
J4.7               NC
@end
@remark RESET_A and RESET_B are mounted on separate panels, at least 2 m apart.
@provided startup.S · link.ld · datasheet · your library
@driver deadline_arm / deadline_expired — wait for a deadline, not an edge
@hint1 Jonas: What happens in your code if ACK just… stops? Nothing ever changes again?
@hint2 Jonas: You're waiting for an edge. Wait for a deadline instead. Every ACK edge pushes the deadline out.
@hint3 Werner: Amendment to WO 7731-06. Reload a 250 ms countdown on each ACK edge. On expiry, drive ENABLE low and latch. Release only when both resets read pressed in one sample.
@after ch3_wo4_after
