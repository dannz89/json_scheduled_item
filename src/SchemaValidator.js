import { existsSync, readFile } from 'fs';
import AddDraft04 from 'ajv-draft-04';
import scheduleItemSchema from './schedule_item.json' assert {type: "json"};


/**
 * Determine whether the schedule item should display on the date supplied. Returns true if the 
 * date matches the item's criteria else false. A schedule item object validated against the
 * schedule item schema then JSON.parse'd into an object is assumed.
 * @param {*} scheduleItem 
 * @param {*} date 
 * @returns 
 */
function showItem(scheduleItem,date) {
    const checkDate = new Date(date);
    console.log(`DEBUG: checkDate = ${checkDate}`);
    
    // Create a deep copy to keep the function pure.
    let itemToCheck = JSON.parse(JSON.stringify(scheduleItem));

    // If the item appears once and its date is the same as today, display it.
    if(itemToCheck['occurrences']['once']) {
        const scheduleDate = new Date(itemToCheck['occurrences']['once']['date']);
        return (scheduleDate.getFullYear() === checkDate.getFullYear()
            && scheduleDate.getMonth() === checkDate.getMonth()
            && scheduleDate.getDate() === checkDate.getDate());
    }

    // If an item is set to occur nTimes then all that really matters is its end date. So
    // we call the setEndDateOnRepeatingItem to calculate and set the end date then we just
    // carry out all other checks as usual.
    if(itemToCheck['occurrences']['repeats']['ends']['afterNumberOfTimes']){
        itemToCheck = setEndDateOnRepeatingItem(itemToCheck);
    }

    // If the item has an end date and the check date is greater, do not diplay it.
    if(itemToCheck['occurrences']['repeats']['ends']['endDate']){
        const endDate = new Date(itemToCheck['occurrences']['repeats']['ends']['endDate']);
        if(checkDate > endDate) return false;
    }


    // If the item is set to display every day, display it.
    if(itemToCheck['occurrences']['repeats']['daily']) return true;

    // If the item displays weekly and checkDate is one of its designated weekdays, display it.
    // Otherwise definitely don't.
    if(itemToCheck['occurrences']['repeats']['weekly']) {
        let startDate = new Date(itemToCheck['occurrences']['repeats']['ends']['startDate']);
        let startDateFound = false;
        for(let wd in itemToCheck['occurrences']['repeats']['weekly']['weekdays']){
            if(startDate.getDay() === new Date(wd).getDay()){
                startDateFound = true;
                break;
            }
        }
        // Those meddling kids! Set a start date that wasn't one of the allowed week days.
        // But I will not be tricked!
        if(!startDateFound){
            throw new Error("Start date ["+startDate+"] not one of allowed week days. Invalid schedule item.");
        }

        itemToCheck['occurrences']['repeats']['weekly']['weekdays'].forEach(weekDay => {
            if (weekDay === checkDate.getDay()) return true;
        });
        return false;
    }

    // If the item is set to display on the nth weekDay of the month (e.g. 1st Tuesday) and checkDate === this day, then display it. Note that the year part of the date is irrelevant.
    if(itemToCheck['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']){
        const nDay = itemToCheck['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['nDay'];
        const weekDay = itemToCheck['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['weekDay'];

        const [checkNDay,checkWeekDay] = getNthWeekDayInMonth(checkDate);

        return (checkNDay === nDay && checkWeekDay === weekDay);
    }
}

/**
 * Utility function to calculate and set the end date on a scheduleItem if it has the 
 * 'afterNumberOftimes' property set and based upon its other schedule criteria. Assumes
 * the scheduleItem is valid per the schedule item schema.
 * @param {*} scheduleItem 
 * @returns a new ScheduledItem with the enddate set.
 */
function setEndDateOnRepeatingItem(scheduleItem) {
    
    // This should never happen. This function shoiuld only be called on pre-checked
    // schedule items. But just in case, return the original object, unchanged.
    if(!scheduleItem['occurrences']['repeats']['ends']['afterNumberOfTimes']){
        console.log(`DEBUG 4: Schedule item has no number of times set`);
        return scheduleItem;
    }

    // If the schema was validated, this will be a number.
    const afterNumberOfTimes = scheduleItem["occurrences"]["repeats"]["ends"]["afterNumberOfTimes"];
    
    // We do this to create a deep copy of the scheduled item and keep this function pure.
    let newScheduleItem = JSON.parse(JSON.stringify(scheduleItem));
    
    // This field is mandatory if 'ends' is set. The scheduleItem JSON would have 
    // failed validation if the ends property existed and no startDate property existed.
    const startDate = new Date(scheduleItem["occurrences"]["repeats"]["ends"]["startDate"]);
    
    let endDate;
    
    // Take no chances with time setting.
    startDate.setHours(0,0,0,0);
    
    // Easiest calculation. If the item occurs daily then its endDate will be:
    // startDate + (number of daily occurrences - 1). the -1 is because the start date is 
    // included.
    if(scheduleItem['occurrences']['repeats']['daily']) {
        endDate = new Date(startDate.getFullYear(),startDate.getMonth(),startDate.getDate()+(afterNumberOfTimes-1),0,0,0,0);
        newScheduleItem['occurrences']['repeats']['ends']['endDate'] = endDate;
        return newScheduleItem;
    }

    // If the item displays weekly, calculate endDate based on number of weeks. Here the 
    // assumption is that a single occurrence is a whole week's worth of occurrences. For 
    // example, if the item is scheduled for Mon, Tue, Fri each week and occurs 5 times then
    // it will occur on Mon, Tue, Fri for five weeks. So if its first occurrence was in the week
    // beginning Mon 11th Dec 2023, then it would occur for all of the five weeks from Mon
    // 11th Dec 2023 up to and including the week beginning Mon 8th Jan 2024. Thus, it's end 
    // date would be Fri 12th Jan 2024 (the last weekday on which it should show on a UI).
    if(scheduleItem['occurrences']['repeats']['weekly']) {
        const greatestWeekDay = scheduleItem['occurrences']['repeats']['weekly']['weekdays'][scheduleItem['occurrences']['repeats']['weekly']['weekdays'].length-1];

        // The number of days is days-in-week * required number of occurrences-1 since the
        // first week (startDate) counts as one occurrence.
        const daysToAdd = (afterNumberOfTimes-1) * 7;

        endDate = new Date(startDate.getFullYear(),startDate.getMonth(),(startDate.getDate()+(greatestWeekDay-startDate.getDay()))+daysToAdd);

        newScheduleItem['occurrences']['repeats']['ends']['endDate'] = endDate;
        return newScheduleItem;
    }
    
    // If the item is set to display on the nth weekDay of the month (e.g. 5th Tuesday) 
    // then the number of occurrences is assumed to be 'afterNumberOfTimes' months from and
    // including the start date. For example if 'afterNumberOftimes' === 5 and the schedule 
    // item start date was Tue 5th Dec 2023, then its final occurrence (endDate) would be Tue 
    // 30th April 2024. 
    // 
    // Note that in Jan, Feb & Mar 2024 thare no 'fifth Tuesdays' but those months are still 
    // counted as 'occurrences'.
    //
    // For this reason, we must iterate through each momth to find the actual 
    // end date (which is equal to the last day on which the schedule item will appear on the 
    // schedule - (showItem()===true). This is because even though the schedule is set to 
    // occur, for example, 5 times, if the nthWeekDayOfMonth value approaches the end of a 
    // momth, or is a 'higher'number (4-5), each month is less likely to have that day (e.g. 
    // a fifth Tuesday) so there may be fewer actual occurrences than the schedule items's 
    // specific 'requested' value of occurrences. For the same reason, if the final month(s) do 
    // not have the nth weekday specified, the last occurrences will be the latest month within 
    // 'afterNumberOfTimes' months where the nth weekDay is present; which could be earlier 
    // than the number of months 'requested'.
    if(scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']){
        // Developers are vile creatures and they cheat and the they trick with impunity.
        // Because of their untrustworthy nature, we must check that whoever passed the schedule
        // item to this function set a startDate that was indeed itself the nth week day of the
        // month as stipulated by the occurrences settings. The schema validation does not
        // chceck for this so the schema could have passed validation and still have a start
        // date that does not match the nDay / weekDay settings.
        const startDate = new Date(scheduleItem['occurrences']['repeats']['ends']['startDate']);
        
        let [startNDay,startWeekday] = getNthWeekDayInMonth(startDate);

        const nDay = scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['nDay'];
        const weekDay = scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['weekDay'];

        //  If this does not throw an error, we can continue calculating the end date.
        if(startNDay !== nDay || startWeekday !== weekDay) throw new Error("Invalid startDate / repeats in schema.");

        // Be careful here! It is not only a case of adding 'afterNumberOftimes' months to the
        // start date's month because that might take us into another year. Let JS date handle
        // the calculation. Now we are in the right month, we just have to find the 
        // right day. Also, the afterNumberOfTimes is inclusive of the first time. startDate is
        // the first day on which the item will occur so we only need to add 
        // afterNumberOftimes-1 (since startDate already counts as 1 occurrence) to the months. 
        
        // First day of last potential month.
        let maximumPossibleEndDate = new Date(startDate.getFullYear(),startDate.getMonth()+(afterNumberOfTimes-1),1,0,0,0,0);
        
        // We want this to be undefined (falsy) to start with.
        let realEndDate;
        
        // Count the months backwards until we hit one that has the nth weekday requested. That
        // shall be the real endDate.
        while(!realEndDate) {
           let nDayCount = 0;
           
           for(let start = new Date(maximumPossibleEndDate); start.getMonth()===maximumPossibleEndDate.getMonth(); start.setDate((start.getDate()+1))) {
            nDayCount += (start.getDay()===weekDay) ? 1 : 0;
            if(nDayCount === nDay) {
                realEndDate = new Date(start);
                break;
            }
           }

           // If we still haven't found the last occurrence, decrement the month.
           if(!realEndDate) maximumPossibleEndDate.setMonth(maximumPossibleEndDate.getMonth()-1);
        }

        // realEndDate will always get set eventually because at least startDate (the very 
        // first time the schedule item occurred) will be a legitimate occurrence.
        newScheduleItem['occurrences']['repeats']['ends']['endDate'] = realEndDate;
        return newScheduleItem;
    }    

    
}

/**
 * Find and return the number of days in the month of the given date.
 * @param {*} date 
 * @returns 
 */
function getNumberOfDaysInMonth(date){
    // Day 0 of next month is the last day of 'this' month.
    const d = new Date(date.getFullYear(),date.getMonth()+1,0);
    return d.getDate();
}

/**
 * For the given date, works out which n and weekday (e.g. 3rd Wednesday), this date is.
 * Returns a 2-element array containg [n,weekDay].
 */
function getNthWeekDayInMonth(date){
    const checkDate = new Date(date);
    const daysInMonth = getNumberOfDaysInMonth(checkDate);
    const weekDay = checkDate.getDay();
    let nDay=0;
    let i=1;
    
    while (i<=daysInMonth){
        nDay += (new Date(checkDate.getFullYear(),checkDate.getMonth(),i).getDay()===weekDay) ? 1 : 0;
        if (i===checkDate.getDate()) return [nDay,weekDay];
        i++;
    }
}


/**
 * Reads in a file and returns a Promise, in practice, the data or an 
 * throws an error.
 * @param {*} fileName 
 * @returns 
 */
function readAFile(fileName) {
    if(!existsSync(fileName)) throw new Error(`File ${fileName} does not exist.`);

    return new Promise((resolve, reject) => {
        readFile(fileName, (err, data) => {
            console.log(`Reading file ${fileName}`);

            if (err) {
                reject(`Failed to read data from ${fileName}`);
            } else {
                resolve(data.toString("utf-8"));
            }
        });
    });
}

/**
 * Tests validity of schedule items in test file by.
 * 1. Validating against the schedule_item JSON schema.
 * 2. Testsing thoe show()
 */
async function testScheduleItems() {
    let testFile = "src/mock_schedule_items.json";
    let tests = [];
    let testFileData;

    const ajv = new AddDraft04({"strict": false});
    
    // Custom format validator for 'date' (YYYY-MM-DD)
    ajv.addFormat('date', {
            type: 'string',
            validate: (dateFormat) => {
            return /^(\d{4})-(\d{2})-(\d{2})$/.test(dateFormat);
        }
    });

    // Custom format validator for 'time' (HH:MM)
    ajv.addFormat('time', {
        type: 'string',
        validate: (timeFormat) => {
            return /^([01]\d|2[0-3]):([0-5]\d)$/.test(timeFormat);
        }
    });
    
    //ajv.addSchema(scheduleItemSchema,'scheduleItemSchema');
    console.log (ajv.validateSchema(scheduleItemSchema) ? "Schema is valid." : "Schema is invalid.");
    
    try{
        testFileData = await readAFile(testFile);
    } catch(e){
        throw e;
    }

    tests = JSON.parse(testFileData);

    const testDate = new Date();

    tests.forEach(test => {
        console.log(`Testing: ${test['description']}`);
        //console.log (ajv.validate(scheduleItemSchema,test) ? "pass" : "fail" )
        if(ajv.validate(scheduleItemSchema,test)){
            try{
                console.log(`show: ${showItem(test,testDate)}`);
            } catch (e){
                console.log(`Threw ${e} checking dates on schedule item.`);
            }
        } else {
           console.log(`Skipping ${JSON.stringify(test)} because it is not a valid schedule item format.`);
        }
    });
}

testScheduleItems();