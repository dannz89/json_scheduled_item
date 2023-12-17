<h1>Scheduled Item JSON schema test code</h1>

This code is mainly to test the validation and use of JSON schema included in the JSON schema file: <a href="https://github.com/dannz89/json_scheduled_item/blob/master/src/schedule_item.json">schedule_item.json</a>.

The JS implementation of the validation using this schema uses the Ajiv module (npm install ajiv).

This code forms the prototype of code that will eventually be used to work with and display calendar schedule items and includes functionality to handle one-off scheduled items, items that occur on the nth weekday of a month, the nth date in a year, daily, weekly n...n+x weekdays etc.

This code is incomplate and a WIP.

Feel free to copy and use as is with no guarantees.

**TODO:**
1. Implement in JAVA
2. Add JAVA and JS test cases.
3. Further encapsulate validation logic which Ajiv / JSON schema can't handle namely:
    3.1. start date vs repetitions which do not match
4. More testing.