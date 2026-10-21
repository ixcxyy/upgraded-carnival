# ═══════════════════════════ CHAPTER 4 · Vectors (part 1) ═══════════════════════════
# Phase: Scouted. Tech: interrupts, the PIE, writing the vector table.

=== scene ch4_open
@chapter ch4
@place cafe
@location Café Adler · Monday, 07:35
! chapter ch4
~ Mira has his coffee on the counter before he reaches it. Black. Just black.
~ While she rings it up, {his fingers go on the counter|c_tap_cafe}.
Mira: Morning. How's the week going to be?
Elias: I don't know yet. It's Monday.
Mira: That's a very honest answer and a very bad one. Guess.
* "Busy. Someone keeps handing me pieces of something." => ch4_mira_honest
* "Fine." => ch4_mira_fine
! next ch4_wo1

=== scene ch4_mira_honest
@kind call
Elias: Busy. Someone keeps handing me pieces of something, and nobody will tell me what it is.
Mira: Like a jigsaw without the box.
Elias: Like a jigsaw without the box.
Mira: My gran did those. She said you start with the edges, and you stop trying to guess the picture until you've got all four corners.
Elias: That's — actually correct.
Mira: Don't sound so surprised. Grans are usually correct.
! stat warm.mira +1

=== scene ch4_mira_fine
@kind call
Elias: Fine.
? stat:warm.mira>=1 | Mira: You're allowed to say more than one word before eight. It's a café, not a courtroom.
? !stat:warm.mira>=1 | Mira: You said that last time too. I'm keeping count.

=== scene ch4_wo1
@chapter ch4
@place werner_office
@location Werner's office · Monday, 09:00
Werner: Interrupts. You've been polling for a month. That ends today.
~ Codename WICKET. When DOOR goes low, LAMP goes high inside five microseconds — while the main loop grinds through a checksum it isn't allowed to stop.
Elias: The board photo.
Werner: What about it.
Elias: The input is {silkscreened TAMPER, not DOOR|c_tamper}.
Werner: The client calls it a door.
Elias: The board calls it tamper.
Werner: The client is paying for the firmware, not the silkscreen.
! task 4.1

=== scene ch4_wo1_after
@chapter ch4
@place benchfloor
@location Bench floor · Tuesday, 13:10
~ The shared printer by the stores cage jams, as it does twice a day. Elias clears it. The stuck page belongs to someone else: a work order, face up.
~ {WO 7731-04 · SPARROW · Assignee: A. Steiner · Approved by: (blank)|c_printer}
Aaron: That's mine.
~ Aaron takes it without quite snatching it. Same grey jacket. Darker under the eyes than last week.
Aaron: Printer eats everything. It's fine.
Elias: You're on 7731 too.
Aaron: Everyone's on something.
~ He goes back to Bench 5 and puts the page face down. Ten minutes later his phone buzzes, and {he takes the call in the stairwell|c_aaron_call}.
! next ch4_jonas_help

=== scene ch4_jonas_help
@chapter ch4
@place benchfloor
@location Bench 3 · Tuesday, 15:20
Jonas: Elias. Two minutes. Tell me I'm not crazy.
~ Two boards on Jonas's bench, wired together, sulking. One sends. The other hears nothing.
* Look at it. => ch4_help_yes
* "I'm in the middle of something." => ch4_help_no
! next ch4_wo2

=== scene ch4_help_yes
@kind call
Elias: Trivial. Your sender runs at three point three volts, and your receiver wants seventy percent of five before it calls anything high — that's three and a half. You're asking a three-three signal to shout. It can't, so the receiver hears a whisper and calls it nothing, and your scope looks perfect because the scope doesn't care what the receiver thinks.
Jonas: ...in people words?
Elias: One of them is too quiet for the other one.
Jonas: See, you can do it. Level shifter?
Elias: Level shifter.
~ Jonas fixes it in four minutes and hums the whole time.
! stat trust.jonas +1
? stat:trust.jonas>=2 | Jonas: I owe you. Dinner, my place, Thursday. I make the only thing I can make, which is a lot of it.
? stat:trust.jonas>=2 | ! flag jonas_invite
? !stat:trust.jonas>=2 | Jonas: I owe you one. Canteen's on me tomorrow.

=== scene ch4_help_no
@kind call
Elias: I'm in the middle of something.
Jonas: You're always in the middle of something. Fine. I'll ask Sina. She'll say "actually" at me.

=== scene ch4_wo2
@chapter ch4
@place werner_office
@location Werner's office · Wednesday, 09:00
Werner: VIGIL. A thousand-hertz tick, interrupt-driven. The handler stays under two microseconds.
Elias: {"Timer must not stop on debug halt."|c_free_run}
Werner: Correct.
Elias: Everything stops on debug halt. That's what halt is for. You freeze the world and look at it.
Werner: This one doesn't freeze.
Elias: Even with someone standing over it with a debugger.
Werner: Especially then.
~ The ring turns, once.
! flag werner_ring
! task 4.2

=== scene ch4_wo2_after
@chapter ch4
@place benchfloor
@location Bench floor · Wednesday, 16:00
Lea: Friday! Canteen! Dieter from purchasing is leaving after twenty-two years, and I have made a banner, and the banner is enormous, and everyone is coming — including you, Elias. Especially you.
Elias: I don't know Dieter.
Lea: Nobody knows Dieter! That's why it's sad! Come for the cake.
! next ch4_petra

=== scene ch4_petra
@chapter ch4
@place petra_office
@location Petra's office · Wednesday, 17:40
~ Petra signs his timesheet without reading it.
Petra: Werner says you're satisfactory. From Werner, that's a parade.
? followed:c_paperweight | Elias: The board in the acrylic. It has the same header as everything I've built here.
? followed:c_paperweight | Petra: A lot of things have that header. It's a cheap header.
? followed:c_paperweight | Elias: And a U7 footprint. Marked do-not-populate. Same as my boards.
? followed:c_paperweight | Petra: Off the record, Elias — does it matter, right now?
? followed:c_paperweight | ~ She puts the paperweight in a drawer. Not quickly. Just finally.
? stat:susp.petra>=1 | Petra: You're very observant. Werner said you would be. That isn't always a compliment, around here.
Petra: A piece of advice, off the record. Don't let Werner make you into a project.
Elias: What does that mean?
Petra: It means he's very good at it, and {he's done it before|c_done_before}.
~ She pulls her {glasses down from her hair|c_glasses} to read something on her screen, which is the signal that the conversation is over.
! flag petra_advice
! next ch4_thursday

=== scene ch4_thursday
@chapter ch4
@place benchfloor
@location Bench floor · Thursday, 18:30
~ Thursday. The floor empties in its usual order: Lea, loudly. Sina, last. Aaron, not at all.
* [flag:jonas_invite] Dinner at Jonas's. -> ch4_jonas_flat
* [tag:aaron>=2] Stay late. Aaron's still here. -> ch4_dock
* [!tag:aaron>=2] Stay late. -> ch4_late
* Go home. -> ch4_home

=== scene ch4_jonas_flat
@chapter ch4
@place jonas_flat
@location Jonas's flat · Thursday, 19:30
~ Third floor, no lift, a kitchen that is mostly one enormous pot. Jonas's {socks don't match|c_socks}. They never do.
Jonas: Pasta. It's always pasta. It's a lot of pasta. Sit.
~ The fridge is a collage: takeaway menus, a niece's drawing of a horse, and {a photo of the bench floor at a summer party|c_fridge_photo}.
Jonas: So. One month. How is it really? Not the Werner answer. The real one.
Elias: The work is easy. The work orders aren't.
Jonas: ...in people words?
Elias: I know how to build everything they give me. I don't know what any of it is for, and I can't stop trying to work it out.
Jonas: Yeah. That's the job, for a while. You get used to it.
Elias: Did you?
Jonas: Mostly. {I did a bring-up in Area 2 once.|c_jonas_area2} Two days. They took my phone at the door. Nice boards. Same stupid ten-pin header everybody uses.
~ He says it the way people say things they have never thought about twice.
Jonas: Anyway. More pasta. You're too thin, and it's making Mira sad.
Elias: Mira said that?
Jonas: Mira said "your friend should eat." Which, from Mira, is a speech.
! stat trust.jonas +1
! next ch4_party

=== scene ch4_dock
@chapter ch4
@place dock
@location Loading dock · Thursday, 22:40
~ The dock door is propped open with a fire extinguisher, which is against at least three rules. Aaron is sitting on the edge of the dock, jacket on, phone in hand, not calling anyone.
Aaron: Oh. Hey.
Elias: You're here late.
Aaron: So are you.
Elias: I'm always here late. You're usually here early.
Aaron: Both, lately. Early and late. It's fine.
? stat:susp.aaron>=1 | Aaron: You heard me. On the stairs, on Tuesday. Didn't you.
? stat:susp.aaron>=1 | ~ Elias doesn't answer, which is an answer.
* "It doesn't sound fine." => ch4_dock_push
* Sit down next to him and say nothing. => ch4_dock_sit
! next ch4_party

=== scene ch4_dock_push
@kind call
Elias: It doesn't sound fine.
~ Aaron looks at the phone. Then at the car park. Then at Elias, as if deciding what a person like Elias is for.
Aaron: My mother's care home put the fees up. Again. So I took extra work. Evenings. It pays well.
Elias: Extra work from whom?
Aaron: From here. {Not through Werner.|c_not_werner} It's test rigs, Elias. It's fine.
~ He stands up and goes inside. He leaves the extinguisher where it is.
! stat trust.aaron +1
! flag aaron_told

=== scene ch4_dock_sit
@kind call
~ Elias sits. The car-park lights buzz at a frequency he could name, and doesn't.
~ After a while Aaron says, to nobody in particular, "It's fine." And then, quieter: "It isn't, actually. My mum's care home. Extra work, evenings, from here. {Not through Werner.|c_not_werner}"
~ Then he goes inside.
! stat trust.aaron +1
! flag aaron_told

=== scene ch4_late
@chapter ch4
@place benchfloor
@location Bench floor · Thursday, 21:58
~ He works until ten. The floor is empty except for one light: Werner's office.
~ At 21:58 Werner turns it off and walks past Bench 6 {without looking at it|c_werner_bench}.
~ Or without looking at him. It's hard to tell which.
! next ch4_party

=== scene ch4_home
@chapter ch4
@place flat
@location The new flat · Thursday, 20:00
~ The radiator ticks nine times and pauses. He has stopped counting. He has mostly stopped counting.
~ The phone rings at eight exactly. Only one person he knows calls at exact hours.
Brandt: Elias. Am I interrupting?
Elias: No.
Brandt: You are eating.
Elias: That wasn't a question.
Brandt: It was an instruction disguised as an observation. An old habit.
* "Did you tell them about me?" => ch4_ask_brandt
* Tell him about the city. => ch4_city
! next ch4_party

=== scene ch4_ask_brandt
@kind call
Elias: Did you tell them about me? %FIRMSHORT%.
~ A pause, long enough to hear the line hiss.
Brandt: I told them you existed. {You did the rest yourself, which is exactly what worries me.|c_brandt_worries}
Elias: Why does it worry you?
Brandt: Because you will do the rest yourself for the rest of your life, and very few people will stop you. Eat something. Mind the signal under the noise.
! stat trust.brandt +1
! flag brandt_worried

=== scene ch4_city
@kind call
Elias: The city's fine. There's a café. The owner draws people.
Brandt: Does she draw you?
Elias: My hands.
Brandt: Then she is paying attention to the right part.
! stat trust.brandt +1
