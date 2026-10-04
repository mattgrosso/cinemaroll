<template>
  <div class="rating-card">
    <label class="rating-card-label" :for="name">{{ label }}</label>
    <p class="rating-card-description">{{ description }}</p>
    <select class="form-select" :name="name" :id="name" v-model="selected">
      <option value=""></option>
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
  </div>
</template>

<script>
// Presentational select for one rating criterion. Extracted from RateMovie's
// eight near-identical inline blocks. Uses a real native <select> v-model
// (proxied through `selected`) so binding semantics — string option values, a
// null initial showing the leading empty option — match the original markup
// exactly. All scoring/default logic stays in the parent.
export default {
  name: 'RatingSelect',
  props: {
    label: { type: String, required: true },
    description: { type: String, default: '' },
    name: { type: String, required: true },
    // [{ value: '0', label: '0 - Worst in class' }, ...] — the leading empty
    // option is rendered by this component, not included here.
    options: { type: Array, required: true },
    modelValue: { default: null }
  },
  emits: ['update:modelValue'],
  computed: {
    selected: {
      get () {
        return this.modelValue;
      },
      set (value) {
        this.$emit('update:modelValue', value);
      }
    }
  }
};
</script>

<style lang="scss" scoped>
@import '@/assets/scss/detail-scale';
/* One dark card per criterion, in the film page's tile language
   (2026-09-30). The select stays native: on a phone it opens the system
   wheel, which is the fastest way to pick one of eleven labelled values. */
.rating-card {
  background: rgba(255, 255, 255, 0.06);
  border-radius: 6px;
  margin: 0 0 8px;
  padding: 10px 12px 12px;
}

.rating-card-label {
  color: #6fb8ff;
  display: block;
  font-size: ds(0.7rem);
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rating-card-description {
  color: #ccc;
  font-size: ds(0.8rem);
  line-height: 1.35;
  margin: 2px 0 8px;
}
</style>
