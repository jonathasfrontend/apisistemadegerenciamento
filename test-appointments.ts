import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testAppointments() {
  console.log('\n=== Testing Appointments Query ===\n');

  // 1. Get all appointments without filter
  const allAppointments = await prisma.appointment.findMany({
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      client: {
        select: {
          name: true,
        },
      },
      staff: {
        select: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log('📊 Total appointments in database:', allAppointments.length);
  console.log('\nAll appointments:');
  allAppointments.forEach((apt, index) => {
    console.log(`${index + 1}. ${apt.client.name} - ${apt.staff.user.name}`);
    console.log(`   Start: ${apt.startTime.toISOString()}`);
    console.log(`   End: ${apt.endTime.toISOString()}`);
    console.log(`   Status: ${apt.status}`);
    console.log(`   ID: ${apt.id}\n`);
  });

  // 2. Test with date filter for 2025-12-18
  const dateStr = '2025-12-18';
  const startOfDay = new Date(`${dateStr}T00:00:00.000Z`);
  const endOfDay = new Date(`${dateStr}T23:59:59.999Z`);

  console.log('\n=== Filter Test for 2025-12-18 ===');
  console.log('Start of day (UTC):', startOfDay.toISOString());
  console.log('End of day (UTC):', endOfDay.toISOString());

  const filteredAppointments = await prisma.appointment.findMany({
    where: {
      startTime: {
        gte: startOfDay,
        lte: endOfDay,
      },
    },
    select: {
      id: true,
      startTime: true,
      endTime: true,
      status: true,
      client: {
        select: {
          name: true,
        },
      },
      staff: {
        select: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log('\n📅 Appointments on 2025-12-18:', filteredAppointments.length);
  filteredAppointments.forEach((apt, index) => {
    console.log(`\n${index + 1}. ${apt.client.name} - ${apt.staff.user.name}`);
    console.log(`   Start: ${apt.startTime.toISOString()}`);
    console.log(`   End: ${apt.endTime.toISOString()}`);
    console.log(`   Status: ${apt.status}`);
  });

  // 3. Check appointments by date (local time consideration)
  console.log('\n=== Checking appointments with different time ranges ===');
  
  // Try with full day coverage including next day
  const startOfDayBR = new Date(`${dateStr}T03:00:00.000Z`); // Midnight in BR (UTC-3)
  const endOfDayBR = new Date('2025-12-19T02:59:59.999Z'); // 23:59 in BR

  console.log('Start (BR time adjusted):', startOfDayBR.toISOString());
  console.log('End (BR time adjusted):', endOfDayBR.toISOString());

  const appointmentsBR = await prisma.appointment.findMany({
    where: {
      startTime: {
        gte: startOfDayBR,
        lte: endOfDayBR,
      },
    },
    select: {
      id: true,
      startTime: true,
      client: {
        select: {
          name: true,
        },
      },
      staff: {
        select: {
          user: {
            select: {
              name: true,
            },
          },
        },
      },
    },
    orderBy: { startTime: 'asc' },
  });

  console.log('\n📅 Appointments (BR timezone adjusted):', appointmentsBR.length);
  appointmentsBR.forEach((apt, index) => {
    const localTime = new Date(apt.startTime);
    console.log(`${index + 1}. ${apt.client.name} - ${apt.staff.user.name}`);
    console.log(`   UTC: ${apt.startTime.toISOString()}`);
    console.log(`   Local: ${localTime.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`);
  });

  await prisma.$disconnect();
}

testAppointments()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
