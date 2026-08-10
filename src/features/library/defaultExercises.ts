import type { MuscleGroup } from '../../types'

// Seeded on fresh setup so the library isn't empty (SPEC §9). Exact list is
// a build-time call per SPEC §9's own note that it's "TBD at build time."
export interface DefaultExercise {
  name: string
  muscleGroup: MuscleGroup
}

export const DEFAULT_EXERCISES: DefaultExercise[] = [
  // Chest
  { name: 'Barbell Bench Press', muscleGroup: 'chest' },
  { name: 'Incline Barbell Bench Press', muscleGroup: 'chest' },
  { name: 'Dumbbell Bench Press', muscleGroup: 'chest' },
  { name: 'Incline Dumbbell Bench Press', muscleGroup: 'chest' },
  { name: 'Dumbbell Fly', muscleGroup: 'chest' },
  { name: 'Dips', muscleGroup: 'chest' },
  { name: 'Push-Up', muscleGroup: 'chest' },
  // Back
  { name: 'Deadlift', muscleGroup: 'back' },
  { name: 'Barbell Row', muscleGroup: 'back' },
  { name: 'Pendlay Row', muscleGroup: 'back' },
  { name: 'Dumbbell Row', muscleGroup: 'back' },
  { name: 'Pull-Up', muscleGroup: 'back' },
  { name: 'Chin-Up', muscleGroup: 'back' },
  { name: 'Lat Pulldown', muscleGroup: 'back' },
  { name: 'Seated Cable Row', muscleGroup: 'back' },
  { name: 'T-Bar Row', muscleGroup: 'back' },
  // Shoulders
  { name: 'Overhead Press', muscleGroup: 'shoulders' },
  { name: 'Seated Dumbbell Shoulder Press', muscleGroup: 'shoulders' },
  { name: 'Lateral Raise', muscleGroup: 'shoulders' },
  { name: 'Rear Delt Fly', muscleGroup: 'shoulders' },
  { name: 'Face Pull', muscleGroup: 'shoulders' },
  { name: 'Upright Row', muscleGroup: 'shoulders' },
  // Quads
  { name: 'Back Squat', muscleGroup: 'quads' },
  { name: 'Front Squat', muscleGroup: 'quads' },
  { name: 'Leg Press', muscleGroup: 'quads' },
  { name: 'Bulgarian Split Squat', muscleGroup: 'quads' },
  { name: 'Walking Lunge', muscleGroup: 'quads' },
  { name: 'Leg Extension', muscleGroup: 'quads' },
  // Hamstrings
  { name: 'Romanian Deadlift', muscleGroup: 'hamstrings' },
  { name: 'Leg Curl', muscleGroup: 'hamstrings' },
  { name: 'Good Morning', muscleGroup: 'hamstrings' },
  // Glutes
  { name: 'Hip Thrust', muscleGroup: 'glutes' },
  // Calves
  { name: 'Standing Calf Raise', muscleGroup: 'calves' },
  { name: 'Seated Calf Raise', muscleGroup: 'calves' },
  // Biceps
  { name: 'Barbell Curl', muscleGroup: 'biceps' },
  { name: 'Dumbbell Curl', muscleGroup: 'biceps' },
  { name: 'Hammer Curl', muscleGroup: 'biceps' },
  { name: 'Preacher Curl', muscleGroup: 'biceps' },
  // Triceps
  { name: 'Close-Grip Bench Press', muscleGroup: 'triceps' },
  { name: 'Tricep Pushdown', muscleGroup: 'triceps' },
  { name: 'Overhead Tricep Extension', muscleGroup: 'triceps' },
  { name: 'Skull Crusher', muscleGroup: 'triceps' },
  // Core
  { name: 'Plank', muscleGroup: 'core' },
  { name: 'Hanging Leg Raise', muscleGroup: 'core' },
  { name: 'Cable Crunch', muscleGroup: 'core' },
  { name: 'Ab Wheel Rollout', muscleGroup: 'core' },
]
