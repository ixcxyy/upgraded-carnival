# ═══════════════════════════ CHAPTER 4 · Vectors (part 2) ═══════════════════════════

=== scene ch4_party
@chapter ch4
@place canteen
@location Canteen · Friday, 16:00
~ The banner is enormous. DIETER, it says, and then, in smaller letters because Lea {ran out of room|c_banner}, 22 YEARS OF PURCHASING EXCELLENCE.
Lea: Don't tell anyone, but— the cake is from the good place, not the supermarket. I put it on the events budget as "catering." It's technically catering.
~ Werner arrives at 16:00, shakes Dieter's hand, says four sentences, and leaves at 16:30. Exactly 16:30. Lea says he does it every time.
Sina: Actually— the toast said twenty-two years. Dieter started in May. It's twenty-one years and three months.
Jonas: Sina. It's a party.
Sina: Parties can be accurate.
~ Aaron comes for ten minutes, holds a paper plate without eating anything on it, and leaves when his phone buzzes.
Lea: Aaron's been weird. Don't tell anyone, but— {he asked me last week if the firm does salary advances|c_lea_advance}. We don't. I checked. Twice.
Elias: Lea. The renovation. When was it?
Lea: The renovation? Oh — ages ago. Before my time, and I've been here three years. Why?
Elias: No reason.
~ Bench 6 was vacant for fourteen months, according to the asset sheet in his drawer. Lea's renovation is at least three years old.
Elias: (in the notebook) No renovation emptied Bench 6. Lea chose a word.
! demote H_G
~ Later, by the window, Sina is the only one not holding cake.
* Bring her a slice. => ch4_sina_cake
* Leave her be.
! next ch4_saturday

=== scene ch4_sina_cake
@kind call
Elias: The toast was wrong. The cake is correct.
Sina: That's almost a joke.
Elias: It's a statement of fact that happens to be funny.
Sina: That's what Jonas says about you.
~ She takes the cake.
? stat:trust.sina>=1 | Sina: I'm at Bench 1 tomorrow evening. Regression, again. If you want to see how the old test rigs work — Aaron built half of them, and he won't explain them. I will.
? stat:trust.sina>=1 | ! flag sina_invite
! stat trust.sina +1

=== scene ch4_saturday
@chapter ch4
@place flat
@location The new flat · Saturday
~ Saturday. Nothing to build. He builds a shelf, badly, from a kit, and checks every screw twice.
* [flag:sina_invite] Go in to Bench 1. Sina said she'd be there. -> ch4_sina_bench
* Stay in. -> ch4_wo3

=== scene ch4_sina_bench
@chapter ch4
@place sina_bench
@location Bench 1 · Saturday, 19:10
~ The floor is dark except for Bench 1. Sina has a test rig open like a patient on a table: pogo pins, a bed of nails, Aaron's neat labels on every wire.
Sina: This one runs every board through power, clocks and a known-good image before anyone touches it. Aaron built it. It's better than anything a vendor sells.
Elias: He's good.
Sina: He's excellent. He's also asleep at his desk twice a week, and nobody says anything.
Sina: And he's building rigs for boards I've never seen. {There's no ticket for any of them.|c_rigs_noticket}
~ On the shelf above the bench, between two binders: {a spiral-bound proposal with a red stamp across the cover|c_sina_report}.
Sina: You're going to ask why I know the rig this well.
Elias: I was going to ask why you're here on a Saturday.
Sina: Actually— those are the same question.
~ She re-seats a pogo pin that was already seated.
Sina: When you come up the normal way, you don't get to be wrong. People who get fast-tracked get to be wrong. They call it learning.
Elias: I was fast-tracked.
Sina: I know. That's why I'm telling you. So you know what it costs the people standing next to you.
! stat trust.sina +1
! flag sina_opened
! next ch4_wo3

=== scene ch4_wo3
@chapter ch4
@place werner_office
@location Werner's office · Monday, 09:00
Werner: SEXTANT. Two interrupt sources. The serial receiver will be flooded — deliberately. The OVR line must still be serviced inside three microseconds.
Elias: OVR.
Werner: Override.
Elias: Override of what?
Werner: That's not something I can tell you.
Elias: The ticket says OVR must be honoured {even if the application has hung|c_ovr_fault}.
Werner: Correct.
Elias: So whatever drives OVR has more authority than the firmware I'm writing.
Werner: Everything has more authority than the firmware you're writing, Voss. That is rather the point of a hierarchy.
! task 4.3

=== scene ch4_recall
@chapter ch4
@place benchfloor
@location Bench 6 · Monday, 21:15
~ The last work order of the month is tomorrow. Werner said so, in the voice he uses for facts.
~ The floor is empty. The notebook is open. He has been writing for an hour without deciding to.
! recall
Jonas: You're still here.
~ Jonas, jacket on, keys in hand, holding two coffees from the machine that has been broken since March. Apparently it works if you hit it correctly.
Jonas: That's a lot of arrows.
Elias: It's a lot of evidence.
Jonas: Okay. But which of these do you actually believe right now?
! believe
Jonas: See? That's shorter than the notebook.
Elias: The notebook is thorough.
Jonas: The notebook is a lot, Elias. Drink your coffee. Go home. It'll still be there tomorrow.
! next ch4_cafe2

=== scene ch4_cafe2
@chapter ch4
@place cafe
@location Café Adler · Tuesday, 07:40
~ He didn't sleep much. Mira can tell from the door.
Mira: You look like someone who wrote in a notebook until midnight.
? stat:warm.mira>=1 | Mira: Corners?
? stat:warm.mira>=1 | Elias: Three. Maybe four.
Mira: Coffee. Black. And a pastry, which you didn't order, and which you are going to eat.
* Eat the pastry. Ask what she's been drawing. => ch4_mira_stay
* "Just the coffee. Thanks." => ch4_mira_coffee
! next ch4_wo4

=== scene ch4_mira_stay
@kind call
Elias: What do you draw? When it's quiet.
Mira: Whatever keeps still. Cups. Hands. The delivery van, apparently forever.
Mira: What do you do? Actually do. Jonas says "computers," but Jonas says that about the fridge.
Elias: I make small boards do exactly one thing, on time.
Mira: That sounds lonely for the boards.
Elias: They're not lonely. They have each other.
~ He hears himself say it, and doesn't know yet why it sounds true.
! stat warm.mira +1

=== scene ch4_mira_coffee
@kind call
Elias: Just the coffee. Thanks.
Mira: The pastry stays on the counter. It'll be here if you change your mind.
~ He doesn't. It is still there when he leaves, with a napkin over it.

=== scene ch4_wo4
@chapter ch4
@place werner_office
@location Werner's office · Tuesday, 09:00
Werner: HEARTH. Last work order this month. No startup file this time. You write the vector table and the reset path yourself.
~ The ticket: a supervisor. It watches an input for a heartbeat — two short pulses and a long gap, once a second — and raises ALARM if two frames go missing.
~ The input is on J4, pin 7. The ticket calls it {HB_IN|c_hb_in}.
~ Every board he has touched in this building has had a J4. On every one of them, pin 7 was marked NC.
Werner: Questions.
* "Where does the heartbeat come from?" => ch4_hearth_ask
* "No questions." => ch4_hearth_none
! task 4.4

=== scene ch4_hearth_ask
@kind call
Elias: Where does the heartbeat come from?
Werner: From whatever the client connects to J4.
Elias: The MARLOW capture. Channel three. This exact pattern, on a pin marked NC.
~ Werner's ring turns. Once. Twice.
Werner: That's not something I can tell you.
Elias: Is it something you know?
Werner: Voss.
~ Just his name. Not raised. It lands like a door closing, gently, all the way.
! stat susp.werner +1

=== scene ch4_hearth_none
@kind call
Elias: No questions.
Werner: Good.
~ It is the first time Werner has said "good." Elias isn't sure it was praise.

=== scene ch4_wo4_after
@chapter ch4
@place werner_office
@location Werner's office · Friday, 17:00
Werner: HEARTH passed. Satisfactory.
Werner: Your badge.
~ He holds out a hand. Elias gives him the badge. Werner swipes it through a reader on the desk, types something, and hands it back.
Werner: From Monday, it opens Area 2.
Elias: What's in Area 2?
Werner: Work that requires Area 2.
Elias: Wait— on the first day. At the university. You said my applications.
Werner: I did.
Elias: You'd read my exam.
Werner: I had.
Elias: Why say applications?
~ The ring doesn't move. Werner looks at him for a long moment, and for the first time there is something in his face that isn't composure. It looks almost like an apology, filed and put away.
Werner: Because the true answer wasn't mine to give. It still isn't. Monday. Nine. Sharp.
! flag area2_badge
! next ch4_final

=== scene ch4_final
@chapter ch4
@place flat
@location The new flat · Friday night
~ A letter on the mat. Cream paper, fountain pen.
! doc doc_letter2
Brandt [letter]: Dear Elias — Jonas? You mentioned a Jonas. Good. Keep him.
Brandt [letter]: A question to end your first month: {what is a watchdog, if not a clock that expects to be missed?|c_watchdog}
Brandt [letter]: Mind the signal under the noise. — A.B.
~ He puts the letter on the table, next to the notebook. Then he does something he hasn't done before: he lays out every board he has worked on, in order. The lab board. The exam board, from memory. CINDER, TALLY, MARLOW, LINDEN. WICKET, VIGIL, SEXTANT, HEARTH.
! codex devices
~ Every one of the firm's boards has the same ten-pin header along one edge.
~ He checks the stove. It's off. He checks it again.
~ It's still off. It's always off the first time.
! endchapter ch4
! ending

# ─────────────────────────── epilogue fragments ───────────────────────────

=== scene coda_pattern
@chapter epilogue
@place flat
@location The new flat · 02:10
~ HEARTH's debug output, running against the MARLOW capture on his laptop: every seventeenth frame, one short gap, one pulse on the debug pin. The count ticks. One. Two. Three.
~ Jitter doesn't keep time. This keeps time.
~ He writes to Brandt. Not a letter; a message, which Brandt hates. One line.
Elias [message]: Who built the exam board?
~ The reply arrives at 06:00, to the minute.
Brandt [message]: Mind the signal under the noise.
~ Nothing else. For the first time in four years, the sign-off is the whole letter.
! flag pattern_sent

=== scene coda_sina
@chapter epilogue
@place benchfloor
@location Bench floor · Monday, 07:58
~ Sina is at Bench 6 when he arrives. Not at hers. His.
Sina: Your HEARTH supervisor. I read it. You debounce the heartbeat edges inside the handler.
Elias: Yes.
Sina: Actually—
~ She stops. Starts again, lower.
Sina: I'd do it with the timer capture instead. Less time in the handler. But yours works.
Elias: Show me.
~ She does. It takes eleven minutes. At the end, without looking at him, she says: "My proposal did it that way. Rev three."
~ It is the first thing she has offered him that she didn't have to.

=== scene coda_aaron
@chapter epilogue
@place benchfloor
@location Bench floor · Friday, 22:15
~ Aaron's rig is half finished and due Monday, and Aaron is asleep at Bench 5 with his head on his arms.
~ Elias reads the rig's test plan. It's good. It's nearly done. It needs four hours he doesn't have to give.
~ He gives them.
~ At half past two Aaron wakes, sees the finished rig, sees Elias, and says nothing for a long time.
Aaron: You didn't have to. It's fine.
Elias: I know.
Aaron: ...It's not fine. Elias. It's not.
~ It is the first time he has said anything else.

=== scene coda_mira
@chapter epilogue
@place cafe
@location Café Adler · Saturday, 10:20
Mira: Can I show you something? You have to promise not to be weird about it.
~ She turns the sketchbook around. Pages of hands. His hands. Around a cup, flat on the counter, tapping.
Mira: You tap the same thing every morning. I started writing it down, like music. Look.
~ Under each sketch, in pencil: two short marks and a long dash. Two short marks and a long dash.
~ He knows that rhythm. He has written it in C, twice.
Mira: What is it? A song?
Elias: It's something I've been working on.
Mira: It's nice. It sounds like something waiting.
~ He doesn't tap for the rest of the morning. He has to think about not doing it, which is new.
