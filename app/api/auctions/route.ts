import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET() {
  try {
    const auctions = await prisma.auctionContract.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ auctions });
  } catch (error) {
    console.error('Error fetching auctions:', error);
    return NextResponse.json({ error: 'Failed to fetch auctions' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { contractAddress, itemDescription } = await request.json();

    if (!contractAddress || !itemDescription) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const auction = await prisma.auctionContract.create({
      data: {
        contractAddress,
        itemDescription,
      },
    });

    return NextResponse.json({ auction }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating auction:', error);
    if (error.code === 'P2002') {
      return NextResponse.json({ error: 'Auction already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create auction' }, { status: 500 });
  }
}
