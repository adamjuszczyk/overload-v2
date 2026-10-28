# Design boards for 1.2

Copied from the design canvas for SPEC change 1.2. SPEC.md → "Design boards [1.2]" says how to use them: boards decide layout, order, wording and what is visible versus behind ⋯; SPEC.md decides behaviour and wins any disagreement (it also lists the known gaps). Never pixel-match. Sample data is sample data.

- `png/` — one image per board, light theme, 390 px wide (phone width).
- `source/` — the board source in the canvas format (HTML with `{{…}}` placeholders; the sample data is in each file's script). Readable for exact wording and colours; not runnable on its own. A file with a `<dc-import>` shows another board with different settings.

| ID | Board | Image | Source |
|---|---|---|---|
| 1 | Plan — this week (week-dependent) | png/1-Main.png | source/Main.dc.html |
| 1a | Plan — this week (stable program) | png/1a-PlanStable.png | source/PlanStable.dc.html |
| 1b | Next week, not planned yet | png/1b-PlanForward.png | source/PlanForward.dc.html |
| 1c | Past week, read only | png/1c-PlanPastWeek.png | source/PlanPastWeek.dc.html |
| 1d | Sequence program (cycle, slots) | png/1d-PlanSequence.png | source/PlanSequence.dc.html |
| 1e | Week ⋯ menu | png/1e-PlanWeekMenu.png | source/PlanWeekMenu.dc.html |
| 2 | COPY — last week's numbers | png/2-PlanCopySheet.png | source/PlanCopySheet.dc.html |
| 3 | VOLUME — sets per muscle | png/3-PlanVolumeSheet.png | source/PlanVolumeSheet.dc.html |
| 4 | REVIEW — what went differently last week | png/4-PlanReview.png | source/PlanReview.dc.html |
| 5 | Set ⋯ — what is this set? | png/5-SetKindPicker.png | source/SetKindPicker.dc.html |
| 6 | Rep target | png/6-RepTargetPicker.png | source/RepTargetPicker.dc.html |
| 7 | RIR target | png/7-RirTargetPicker.png | source/RirTargetPicker.dc.html |
| 8 | Cues for a set | png/8-TagSheet.png | source/TagSheet.dc.html |
| 9 | Cell and row states | png/9-PlanStates.png | source/PlanStates.dc.html |
| 10 | Session states | png/10-PlanSessionStates.png | source/PlanSessionStates.dc.html |
| 11 | A done session, read only | png/11-PlanDone.png | source/PlanDone.dc.html |
| 12 | Loading and errors | png/12-PlanLoad.png | source/PlanLoad.dc.html |
| PR1 | Programs, a program running | png/PR1-Programs.png | source/Programs.dc.html |
| PR2 | No program running, PLAN tapped | png/PR2-PlanEmpty.png | source/PlanEmpty.dc.html |
| PR3 | No programs yet | png/PR3-ProgramsEmpty.png | source/ProgramsEmpty.dc.html |
| PR4 | Loading | png/PR4-ProgramsLoading.png | source/ProgramsLoading.dc.html |
| PR5 | Priorities of the current program | png/PR5-PlanPriorities.png | source/PlanPriorities.dc.html |
| PR6 | Finish the program | png/PR6-EndMeso.png | source/EndMeso.dc.html |
| PR7 | Finish, pending | png/PR7-ProgramsEndMesoPending.png | source/ProgramsEndMesoPending.dc.html |
| PR8 | Start a program | png/PR8-ProgramsStartSheet.png | source/ProgramsStartSheet.dc.html |
| PR9 | Start a new program while one runs | png/PR9-ProgramsStartActive.png | source/ProgramsStartActive.dc.html |
| PR10 | Start failed, the real reason shown | png/PR10-ProgramsStartError.png | source/ProgramsStartError.dc.html |
| PR11 | Start, program has no schedule | png/PR11-ProgramsStartBlocked.png | source/ProgramsStartBlocked.dc.html |
| PR12 | Start, create a program first | png/PR12-ProgramsStartEmpty.png | source/ProgramsStartEmpty.dc.html |
| PR13 | New program, nothing chosen yet | png/PR13-ProgramsNewSheet.png | source/ProgramsNewSheet.dc.html |
| PR13b | New program, both chosen | png/PR13b-ProgramsNewSheetReady.png | source/ProgramsNewSheetReady.dc.html |
| PR14 | A finished program | png/PR14-MesoHistory.png | source/MesoHistory.dc.html |
| PR15 | Delete a finished program | png/PR15-ProgramsDeleteMeso.png | source/ProgramsDeleteMeso.dc.html |
| PL1 | Change the program from week 2 (week-dependent) | png/PL1-Planner.png | source/Planner.dc.html |
| PL1b | Change the program from week 2 (stable) | png/PL1b-PlannerStable.png | source/PlannerStable.dc.html |
| PL2 | Exercise ⋯: rest, tempo, unit | png/PL2-PlannerExerciseSheet.png | source/PlannerExerciseSheet.dc.html |
| PL3 | Superset member ⋯ | png/PL3-PlannerExerciseSheetMember.png | source/PlannerExerciseSheetMember.dc.html |
| PL4 | Swap exercise | png/PL4-PlannerPicker.png | source/PlannerPicker.dc.html |
| PL5 | Add exercise | png/PL5-PlannerPickerAdd.png | source/PlannerPickerAdd.dc.html |
| PL6 | Picker, none in this group | png/PL6-PlannerPickerEmpty.png | source/PlannerPickerEmpty.dc.html |
| PL7 | Remove exercise from week 2 | png/PL7-PlannerRemove.png | source/PlannerRemove.dc.html |
| PL8 | Remove warmup item | png/PL8-PlannerRemoveWarmup.png | source/PlannerRemoveWarmup.dc.html |
| PL9 | Warmup routine and rest states | png/PL9-PlannerStates.png | source/PlannerStates.dc.html |
| PP1 | 1 priorities | png/PP1-PlannerPriorities.png | source/PlannerPriorities.dc.html |
| PP1b | One workout, several weekdays | png/PP1b-ProgramPlannerShared.png | source/ProgramPlannerShared.dc.html |
| PP2 | 2 exercises | png/PP2-PlannerExercises.png | source/PlannerExercises.dc.html |
| PP2b | Sequence schedule | png/PP2b-ProgramPlannerSequence.png | source/ProgramPlannerSequence.dc.html |
| PP2c | Add workout, add or change slot | png/PP2c-ProgramPlannerSheets.png | source/ProgramPlannerSheets.dc.html |
| PP2d | Add exercise | png/PP2d-ProgramPlannerPicker.png | source/ProgramPlannerPicker.dc.html |
| PP2d2 | Add exercise, empty | png/PP2d2-ProgramPlannerPickerEmpty.png | source/ProgramPlannerPickerEmpty.dc.html |
| PP2e | Editing in place | png/PP2e-ProgramPlannerEditing.png | source/ProgramPlannerEditing.dc.html |
| PP2f | Editing the warmup routine | png/PP2f-ProgramPlannerEditingSets.png | source/ProgramPlannerEditingSets.dc.html |
| PP3 | 3 volume | png/PP3-PlannerVolume.png | source/PlannerVolume.dc.html |
| PP3b | 3 volume, stable | png/PP3b-ProgramPlannerVolumeCustom.png | source/ProgramPlannerVolumeCustom.dc.html |
| PP3c | Set type, from a set number | png/PP3c-ProgramSetType.png | source/ProgramSetType.dc.html |
| PP3d | Rep target, from a set | png/PP3d-ProgramRepTarget.png | source/ProgramRepTarget.dc.html |
| PP4 | Confirmations | png/PP4-ProgramPlannerConfirms.png | source/ProgramPlannerConfirms.dc.html |
| PP4b | Split a shared workout | png/PP4b-ProgramPlannerConfirmsSplit.png | source/ProgramPlannerConfirmsSplit.dc.html |
| PP5 | Loading, missing, start | png/PP5-ProgramPlannerStates.png | source/ProgramPlannerStates.dc.html |
| PP5b | Saving and start states | png/PP5b-ProgramPlannerStatesActions.png | source/ProgramPlannerStatesActions.dc.html |
| PP6 | Empty states | png/PP6-ProgramPlannerEmpty.png | source/ProgramPlannerEmpty.dc.html |
| W1 | In progress | png/W1-Workout.png | source/Workout.dc.html |
| W2 | Set row states | png/W2-SetStates.png | source/SetStates.dc.html |
| W2b | Editing a logged set (type, unlog, delete) and warmups | png/W2b-SetEditStates.png | source/SetEditStates.dc.html |
| W3 | Stage rows | png/W3-WorkoutStages.png | source/WorkoutStages.dc.html |
| W3b | Added and skipped sets | png/W3b-WorkoutAddedSets.png | source/WorkoutAddedSets.dc.html |
| W4 | Header, rest and jump states | png/W4-WorkoutStates.png | source/WorkoutStates.dc.html |
| W5 | Swapped and added exercises | png/W5-WorkoutCards.png | source/WorkoutCards.dc.html |
| W6 | Offline and sync failed | png/W6-WorkoutOffline.png | source/WorkoutOffline.dc.html |
| W7 | Set options | png/W7-SetSheet.png | source/SetSheet.dc.html |
| W7a | Set type, changed in a workout | png/W7a-WorkoutSetType.png | source/WorkoutSetType.dc.html |
| W7b | Log out of order (lock on) | png/W7b-WorkoutLogOrder.png | source/WorkoutLogOrder.dc.html |
| W8 | Option sheet states | png/W8-WorkoutSheets.png | source/WorkoutSheets.dc.html |
| W9 | Delete a set | png/W9-WorkoutDeleteSet.png | source/WorkoutDeleteSet.dc.html |
| W10 | Exercise options | png/W10-ExerciseSheet.png | source/ExerciseSheet.dc.html |
| W11 | Swap exercise | png/W11-SwapSheet.png | source/SwapSheet.dc.html |
| W13 | Add exercise | png/W13-WorkoutAddExercise.png | source/WorkoutAddExercise.dc.html |
| W14 | Confirm add | png/W14-WorkoutAddConfirm.png | source/WorkoutAddConfirm.dc.html |
| W15 | Picker states | png/W15-WorkoutPickerStates.png | source/WorkoutPickerStates.dc.html |
| W16 | Last time | png/W16-Reference.png | source/Reference.dc.html |
| W17 | Last time states | png/W17-WorkoutReference.png | source/WorkoutReference.dc.html |
| W18 | Finish session | png/W18-SessionComplete.png | source/SessionComplete.dc.html |
| W19 | Finish a reopened session | png/W19-WorkoutFinishReopened.png | source/WorkoutFinishReopened.dc.html |
