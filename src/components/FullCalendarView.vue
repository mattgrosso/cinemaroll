<template>
  <div lang="en" class="full-calendar">
    <FullCalendar v-if="open" ref="fullCalendar" :options="calendarOptions" />
  </div>
</template>

<script>
import FullCalendar from '@fullcalendar/vue3'
import dayGridPlugin from '@fullcalendar/daygrid'
import interactionPlugin from '@fullcalendar/interaction'
import timeGridPlugin from '@fullcalendar/timegrid';
import multiMonthPlugin from '@fullcalendar/multimonth'
import listPlugin from '@fullcalendar/list';

export default {
  name: "FullCalendarView",
  components: {
    FullCalendar
  },
  props: {
    results: {
      type: Array,
      required: true
    },
    open: {
      type: Boolean,
      required: true
    }
  },
  computed: {
    calendarOptions () {
      return {
        plugins: [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, multiMonthPlugin],
        initialView: 'dayGridMonth',
        events: this.values,
        headerToolbar: {
          left: 'title',
          center: '',
          right: 'prev,next'
        },
        dayHeaderFormat: { weekday: 'short' },
        height: 'auto',
        eventContent: (args) => {
          return args.event.title;
        },
        dayCellContent: (args) => {
          return args.date.getDate();
        },
        datesSet: () => {
          this.setClassesForDates();
        }
      }
    },
    values () {
      const eventObjects = [];

      this.results.forEach((result) => {
        result.ratings.forEach((rating) => {
          eventObjects.push({
            title: result.movie.title,
            start: new Date(new Date(rating.date).setMinutes(new Date(rating.date).getMinutes() - result.movie.runtime)),
            end: new Date(rating.date)
          });
        });
      });

      return eventObjects;
    },
    datesWithCounts () {
      const dateCounts = {};
      this.values.forEach(value => {
        const date = new Date(value.end).toLocaleDateString();
        if (date in dateCounts) {
          dateCounts[date]++;
        } else {
          dateCounts[date] = 1;
        }
      });
      return dateCounts;
    },
    totalCountInDatesWithCounts () {
      return Object.values(this.datesWithCounts).reduce((a, b) => a + b, 0);
    },
  },
  methods: {
    setClassesForDates () {
      const dateElements = document.querySelectorAll('.fc-daygrid-day');
      dateElements.forEach((element) => {
        const dateValue = element.getAttribute('data-date').split('-').map((value) => parseInt(value));
        dateValue[1] = dateValue[1] - 1;

        element.classList.remove('one-event', 'two-events', 'three-events', 'four-events', 'five-or-more-events');
        element.classList.add(this.classForNumberOfViews(new Date(dateValue[0], dateValue[1], dateValue[2])));
      });
    },
    numberOfViewsForDate (date) {
      const dateKey = date.toLocaleDateString();
      return this.datesWithCounts[dateKey] || 0;
    },
    classForNumberOfViews (date) {
      const numberOfViews = this.numberOfViewsForDate(date);
      if (numberOfViews === 0) {
        return 'bg-light';
      } else if (numberOfViews === 1) {
        return 'one-event';
      } else if (numberOfViews === 2) {
        return 'two-events';
      } else if (numberOfViews === 3) {
        return 'three-events';
      } else if (numberOfViews === 4) {
        return 'four-events';
      } else {
        return 'five-or-more-events';
      }
    }
  },
};
</script>

<style lang="scss">
.full-calendar {
  .fc {
    .fc-header-toolbar {
      .fc-toolbar-title {
        font-size: 1.5rem;
      }

      .fc-button {
        padding: 0 8px;
      }
    }

    .fc-view-harness {
      border: 1px solid black;

      .fc-dayGridMonth-view {
        .fc-scrollgrid-section-header {
          .fc-col-header-cell {
            background-color: white;
            border: 1px solid black;

            .fc-scrollgrid-sync-inner {
              align-items: center;
              display: flex;
              justify-content: center;

              .fc-col-header-cell-cushion {
                color: black;
                font-size: 0.7rem;
                text-decoration: none;
              }
            }
          }
        }

        .one-event {
          background-color: #23a1f6;
        }

        .two-events {
          background-color: #96da52;
        }

        .three-events {
          background-color: #ffeb00;
        }

        .four-events {
          background-color: #fb8c00;
        }

        .five-or-more-events {
          background-color: #f43b28;
        }

        .fc-daygrid-day-frame {
          .fc-daygrid-day-top {
            .fc-daygrid-day-number {
              color: black;
              font-size: 0.6rem;
              line-height: 0.6rem;
              text-decoration: none;
            }
          }

          .fc-daygrid-day-events {
            .fc-event {
              color: black;
              display: block;
              font-size: 0.5rem;
              hyphens: auto;
              line-height: 0.5rem;
              white-space: normal;
              word-wrap: break-word;
            }
          }
        }
      }
    }
  }
}

.text-bg-dark {
  .fc-button {
    background: white;
    color: black;
  }
}
</style>