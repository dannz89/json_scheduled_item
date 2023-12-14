import Ajv from 'ajv';
import { existsSync, readFile } from 'fs';
import AddDraft04 from 'ajv-draft-04';
import draft04MetaSchema from './schema-draft-04.json' assert {type: "json"};
import scheduleItemSchema from './schedule_item.json' assert {type: "json"};


/**
 * Determine whether the schedule item should display on the date supplied. Returns true if the 
 * date matches the item's criteria else false.
 * @param {*} scheduleItem 
 * @param {*} date 
 * @returns 
 */
function showItem(scheduleItem,date) {
    const checkDate = new Date(date);

    // If the item appears once and its date is the same as today, display it.
    if(scheduleItem['occurrences']['once']) {
        const scheduleDate = new Date(scheduleItem['occurrences']['once']['date']);
        return (scheduleDate.getFullYear() === checkDate.getFullYear()
            && scheduleDate.getMonth() === checkDate.getMonth()
            && scheduleDate.getDate() === checkDate.getDate());
    }

    // If the item has an end date and the check date is greater, do not diplay it.
    if(scheduleItem['occurrences']['repeats']['ends']['endDate']){
        const endDate = new Date(scheduleItem['occurrences']['repeats']['ends']['endDate']);
        return checkDate > endDate;
    }


    // If the item is set to display every day, display it.
    if(scheduleItem['occurrences']['repeats']['daily']) return true;

    // If the item displays weekly and checkDate is one of its designated weekdays, display it.
    if(scheduleItem['occurrences']['repeats']['weekly']) {
        scheduleItem['occurrences']['repeats']['weekly']['weekdays'].forEach(weekDay => {
            return (weekDay === checkDate.getDay());
        });
    }

    // If the item is set to display on the nth weekDay of the month (e.g. 1st Tuesday) and checkDate === this day, then display it. Note that the year part of the date is irrelevant.
    if(scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']){
        const nDay = scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['nDay'];
        const weekDay = scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['weekDay'];

        const numDaysinMonth = getNumberOfDaysInMonth(checkDate);
        
        let n = 0;

        for(let day = 1; day < numDaysinMonth; day++){
            // If the date we are checking is today and it's the week-day component of the schedule item then increment the 'hit' counter.
            n += (checkDate.getDate() === day && checkDate.getDay() === weekDay) ? 1 : 0;
            
            // If checkDate's date is 'today' and it's the schedule item's weekday and it's the schedule item's nth weekday of month then we are good to display the item.
            if(checkDate.getDate() == day
                && checkDate.getDay() == weekDay 
                && n == nDay) return true;
        }
        // If we exited the loop without a hit, then 'today' (checkDat.getDate()) is not the nth
        // weekDay of the month.
        return false;
    }
}

/**
 * If a schedule item is set to occur a certain number of times or up to and including an
 * end date, then all other checks per showItem() are applied to it iteratively to see if it has
 * met its end date or number of occurrences criteria. 
 * ASSUMPTION: Although the scheduleItem has an 'afterNumberOfTimes' field, this will only be 
 * used as an indicator to developers with its endDate calculated at the intiaal creation based 
 * upon the start date, occurrence criteria for the item and the number of occurrences. 
 * For example, if the item is set to occur on 'nthWeekDayOfMonthy' beginning on the first
 * Tuesday in February and for every first Tuesday of every month with 5 occurrences, then the 
 * endDate (inclusive) should be set to the first Tuesday of June (for 2024, this would be Tue
 * 4th June 2024). So all this function needs to check is whether the item has passed its 
 * endDate rather than calculating whether it has 'occurred' according to its 
 * 'afterNumberOfTimes'. That should have been set up when the item was origionally created.
 * @param {*} scheduleItem 
 * @param {*} date 
 */
function showRepeatingItem(scheduleItem,date) {
    // Check if checkDate is greater than the end date and if it is, do not show the item. 
    // If checkDate <= endDate then, we fall back on checking the other criteria using showItem() and return its return value.
    if(item['occurrences']['repeats']['ends']['endDate']) {
        const endDate = new Date(item['occurrences']['repeats']['ends']['endDate']);
        
        // We don't care about the time, only the date. And we take no chances when it comes to
        // what was stored in the database / set by the previous developer or transferred across
        // the network.
        date.setHours(0,0,0,0);
        checkDate.setHours(0,0,0,0);
        if(date > checkDate) return false;

        return showItem(scheduleItem,date);
    }

}

/**
 * Utility function to calculate and set the end date on a scheduleItem if it has the 
 * 'afterNumberOftimes' property set and based upon its other schedule criteria. Assumes
 * the scheduleItem is valid.
 * @param {*} scheduleItem 
 * @returns a new ScheduledItem with the enddate set.
 */
function setEndDateOnRepeatingItem(scheduleItem) {
    const afterNumberOfTimes = scheduleItem["occurrences"]["repeats"]["ends"]["afterNumberOfTimes"];
    
    // We do this to create a deep copy of the scheduled item.
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
    // beginning Mon 11th Dec 2023, then it would occur for all off the five weeks from Mon
    // 11th Dec 2023 up to and including the week beginning Mon 8th Jan 2024. Thus, it's end 
    // date would be Fri 12th Jan 2024 (the last weekday on which it showed on the schedule).
    if(scheduleItem['occurrences']['repeats']['weekly']) {
        const greatestWeekDay = scheduleItem['occurrences']['repeats']['weekly']['weekdays'][scheduleItem['occurrences']['repeats']['weekly']['weekdays'].length()-1];

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
    // 30th April 2024. There are no 5th Tuesdays.
    // 
    // Note that in Jan, Feb & Mar 2024 thare no 'fifth Tuesdays' but those months are still 
    // counted as 'occurrences'.
    //
    // For this reason, we must iterate through each momth to find the actual 
    // end date (which is equal to the last day on which the schedule item will appear on the 
    // schedule - showItem()===true). This is because even though the schedule is set to occur, 
    // for example, 5 times, if the nthWeekDayOfMonth value approaches the end of a momth, or 
    // is a 'higher'number, each month is less likely to have that day (e.g. a fifth Tuesday) 
    // so there may be fewer actual occurrences thatn the schedule items's specific 'requested' 
    // value of occurrences. For the same reason, if the final month(s) do not have the nth
    // weekday specified, the last occurrences will be the latest month within 
    // 'afterNumberOfTimes' months where the nth weekDay is present.
    if(scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']){
        const nDay = scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['nDay'];
        const weekDay = scheduleItem['occurrences']['repeats']['monthly']['nthWeekDayOfMonth']['weekDay'];
        
        // Be careful here! It is not only a case of adding 'afterNumberOftimes' months to the
        // start date's month because that might take us into another year. Let JS date handle
        // the calculation. Now we are in the right month, we just have to find the 
        // right day. Also, the afterNumberOfTimes is inclusive of the first time. startDate is
        // the first day on which the item will occur so we only need to add 
        // afterNumberOftimes-1 (since startDate already counts as 1 occurrence) to the months. 
        
        // First day of last potential month.
        let maximumPossibleEndMonth = new Date(startDate.getFullYear(),startDate.getMonth()+(afterNumberOfTimes-1),1,0,0,0,0);
        
        // We want this to be undefined (falsy).
        let realEndDate;
        
        // Count the months backwards until we hit one that has the nth weekday requested. That
        // shall be the real endDate.
        while(!realEndDate) {
           let nDayCount = 0;
           
           for(let start = new Date(maximumPossibleEndMonth); start.getMonth()===maximumPossibleEndMonth.getMonth(); start.setDate((start.getDate()+1))) {
            nDayCount += (start.getDay()===weekDay) ? 1 : 0;
            if(nDayCount === nDay) {
                realEndDate = new Date(start);
                break;
            }
           }

           // If we still haven't found the last occurrence, decrement the month.
           if(!realEndDate) maximumPossibleEndMonth.setMonth(maximumPossibleEndMonth.getMonth()-1);
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

function validateScheduleItem(validationSchema,scheduleItem){
    if(!ajv.validate(validationSchema,JSON.stringify(scheduleItem))) {
        console.warn(`Item [${scheduleItem}] not a valid schedule item.`);
        return false;
    }
}


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


async function getValidationSchema() {
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

    console.log(`Preparing to validate ${testFileData}`);

    tests = JSON.parse(testFileData);

    tests.forEach(test => console.log (ajv.validate(scheduleItemSchema,test) ? "pass" : "fail" ));
}



getValidationSchema();


// Tests go here.