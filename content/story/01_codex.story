# ═══════════════════════════ DOCUMENTS ═══════════════════════════
# Unlocked by scenes (! doc id) or at chapter ends (see @@chapter).
# Hotspots inside documents work like hotspots in scenes, and close
# when their chapter closes.

=== doc doc_exam_notice
@title EE-412 · Practical examination notice
@kind Notice
@from Department of Electrical Engineering
The practical examination for EE-412 (Embedded Systems) takes place on Thursday, 11 May, 09:00–12:00, in Exam Hall B.
Each candidate receives one examination board and one task sheet. Examination boards are provided on loan by an {industry partner|c_partner}. Treat them kindly; they are going back.
Permitted: the course datasheet, your own lab reports, a pencil. Not permitted: phones, libraries, frameworks, or your neighbour.
Boards may not leave the hall.
— A. Brandt

=== doc doc_riddles
@title "Brandt riddles, every year I could find"
@kind Forum post
@from EE-412 student forum
Answers not included. You're welcome.
— What does a floating pin know that you don't?
— A clock you can't see is still a clock. How do you find it?
— Why does a resistor never lie, when a scope sometimes does?
— If a register ignores your write, who is it protecting?
— A pin that reads high with nothing attached is not lying to you. What is it telling you? (this year, week 6)
— Why does a careful engineer label a pin "not connected," instead of simply leaving it unlabelled? (this year, week 9)
Every one signed off the same way. You know how.

=== doc doc_exam_report
@title Your exam report (returned)
@kind Record
EE-412 · Practical examination · Candidate: E. Voss · Bench 22
Task: pedestrian crossing controller. All phases within tolerance. Walk requests during green correctly latched.
Margin, in pencil, candidate's hand: "J4.7 is marked NC. It is not NC."
Beside it, in red ink: a tick. Beside the tick, in pencil so faint it may have been erased: the number 5.
Grade: 1.0

=== doc doc_offer
@title Offer of employment
@kind Letter
@from %FIRM%
Position: Embedded Engineer, bench floor.
Reporting to: W. Albrecht.
Start: Monday, 3 July, 09:00. Punctuality is expected.
Location: %FIRMSHORT%, business park east. Parking behind the building.
Cost centre: {7731|c_costcentre}
Relocation allowance: included. Details on request.
Statement of duties: as assigned by work order.

=== doc doc_letter1
@title Letter from Brandt (July)
@kind Letter
@from A. Brandt
Dear Elias — I hope %CITY% is treating you better than its reputation suggests. I confess I have no idea what its reputation is. That seemed the polite assumption.
I will not ask about the work; I suspect you could not tell me. I will ask instead whether you are eating.
A question for your first month: a heartbeat that never falters tells you only that it has not faltered yet. What does it tell you when it does?
Mind the signal under the noise. — A.B.

=== doc doc_policy42
@title Policy 4.2 · Tasking without statement of purpose
@kind Memo
@from Engineering management
4.2.1  Work orders state required behaviour, interfaces and acceptance criteria. They do not state end use.
4.2.2  The "Purpose" field on the work order form is retained for compatibility and is left blank.
4.2.3  Engineers shall not speculate about end use in writing, including personal notes kept on site.
4.2.4  Questions about scope go to the issuing handler. Questions about purpose are not addressed.
Approved: W. Albrecht, P. Lindqvist. Rev 1, eighteen years ago. Rev 4, current.

=== doc doc_bench6
@title Asset sheet · Bench 6
@kind Record
Bench 6 · Bench floor · ESD class 2
Assigned to: E. Voss, from 3 July
Previous assignee: (field left blank)
Status before reassignment: vacant, 14 months
Returned on vacating: 1 × scope probe set · 1 × label printer cartridge · 1 × ESD wrist strap ({engraved, initials not recorded|c_strap})

=== doc doc_letter2
@title Letter from Brandt (August)
@kind Letter
@from A. Brandt
Dear Elias — Jonas? You mentioned a Jonas. Good. Keep him.
A question to end your first month: what is a watchdog, if not a clock that expects to be missed?
Mind the signal under the noise. — A.B.

=== doc doc_wo_index
@title Work order index · 7731 (extract)
@kind Record
Extract generated for badge 0413 (E. Voss). Entries above your access level are shown as restricted.
7731-01   ———————   restricted
7731-02   CINDER    E. Voss      closed
7731-03   TALLY     E. Voss      closed
7731-04   SPARROW   A. Steiner   open
7731-05   MARLOW    E. Voss      closed
7731-06   LINDEN    E. Voss      closed
7731-07   WICKET    E. Voss      closed
7731-08   VIGIL     E. Voss      closed
7731-09   SEXTANT   E. Voss      closed
7731-10   HEARTH    E. Voss      closed
7731-11   ———————   restricted
7731-12   ———————   restricted
… 41 further entries, restricted.

=== doc doc_area2
@title Access notice · Area 2
@kind Notice
Badge 0413 (E. Voss). Area 2 access granted, effective Monday 07:00.
No personal devices beyond the red door. Notes taken inside Area 2 remain inside Area 2.
Authorised: W. Albrecht. Countersigned: P. Lindqvist.

# ═══════════════════════════ DEVICES ═══════════════════════════
# The quiet tab. Every board he touches, in one list.

=== device dev_l1
@name Lab Board L1
@ref University lab board · blue
One chip, two pin headers, one button, one LED. No J4.

=== device dev_exam
@name Exam board · rev A
@ref On loan · green
J4: ten-pin keyed header along one edge. Pin 7 marked NC — and not quiet.
U7 footprint marked DNP in the parts list. Populated.

=== device dev_2210
@name BRD-2210 rev C · CINDER
@ref WO 7731-02
Status blinker. J4: ten-pin keyed header, pin 7 NC. U7: DNP, empty.

=== device dev_2231
@name BRD-2231 rev A · TALLY
@ref WO 7731-03
Press counter. No reset input. J4 present, pin 7 NC. U7: DNP, empty.

=== device dev_2240
@name BRD-2240 rev B · MARLOW
@ref WO 7731-05
Period monitor on J4.3. J4.7 NC — carries a pattern on the client's rig.

=== device dev_2252
@name BRD-2252 rev A · LINDEN
@ref WO 7731-06
Operator-presence monitor. Two reset buttons on separate panels. J4.7 NC.

=== device dev_2260
@name BRD-2260 rev A · WICKET, VIGIL
@ref WO 7731-07, 7731-08
Silkscreen says TAMPER where the ticket says DOOR. J4.7 NC.

=== device dev_2275
@name BRD-2275 rev B · SEXTANT
@ref WO 7731-09
OVR must be honoured even after the application faults. J4.7 NC.

=== device dev_2290
@name BRD-2290 rev A · HEARTH
@ref WO 7731-10
Heartbeat supervisor. J4.7 is HB_IN. The first board where pin 7 is connected.

=== device dev_paperweight
@name Unknown board, in acrylic
@ref Petra's desk
Old prototype. Ten-pin header marked J4. A U7 footprint.

=== device dev_area2
@name Area 2 boards (unseen)
@ref According to Jonas
"Same stupid ten-pin header everyone uses."

# ═══════════════════════════ EPILOGUE FRAGMENTS ═══════════════════════════
# The main ending needs no clicks. These need attention, and sometimes code.

=== coda coda_pattern
@title The Pattern
@kind The machine
@requires tag:pattern>=3 & tagphases:pattern>=2 & taskextra:4.4
@hint Notice what repeats across both halves of the story, and write it into HEARTH.
@scene coda_pattern

=== coda coda_sina
@title Rev Three
@kind A person
@requires stat:trust.sina>=3 & flag:sina_opened & tag:sina>=1
@hint Sina keeps score. Give her reasons to stop, and go where she invites you.

=== coda coda_aaron
@title It's Fine
@kind A person
@requires tag:aaron>=3 & flag:aaron_told
@hint Someone on the bench floor keeps saying it's fine.

=== coda coda_mira
@title Something Waiting
@kind Yourself
@requires stat:warm.mira>=2 & tag:self>=1
@hint Answer the one person who asks how your day was, and watch your own hands.
